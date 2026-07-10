import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const UUID = "61cf27f0-b192-4ca4-a608-1cc1b24f45c3";

function makeEnv(overrides: Record<string, unknown> = {}) {
  const doFetch = vi.fn(async () => Response.json({ scheduled: true }));
  const namespace = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({ fetch: doFetch })),
  };
  return {
    env: {
      SCHEDULE_ALARM: namespace,
      AUTH_WORKER: { fetch: vi.fn() },
      INTERNAL_SHARED_SECRET: "test-secret",
      
      ...overrides,
    } as any,
    namespace,
    doFetch,
  };
}

function put(path: string, secret: string | null, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Internal-Shared-Secret"] = secret;
  return new Request(`https://alarm.example${path}`, {
    method: "PUT",
    headers,
    body: body === undefined ? "not json" : JSON.stringify(body),
  });
}

describe("auth", () => {
  it("fails closed when secret binding is empty", async () => {
    const { env } = makeEnv({ INTERNAL_SHARED_SECRET: "" });
    const res = await worker.fetch(put(`/alarms/${UUID}`, "whatever", { fire_at: "2027-01-01T00:00:00Z" }), env);
    expect(res.status).toBe(503);
  });

  it("rejects wrong or missing secret", async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(put(`/alarms/${UUID}`, "wrong", { fire_at: "2027-01-01T00:00:00Z" }), env)).status).toBe(401);
    expect((await worker.fetch(put(`/alarms/${UUID}`, null, { fire_at: "2027-01-01T00:00:00Z" }), env)).status).toBe(401);
  });
});

describe("routing / validation", () => {
  it("404 outside /alarms/", async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(new Request("https://alarm.example/other", { method: "PUT" }), env);
    expect(res.status).toBe(404);
  });

  it("405 for GET", async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(new Request(`https://alarm.example/alarms/${UUID}`, { method: "GET" }), env);
    expect(res.status).toBe(405);
  });

  it("400 for invalid uuid", async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(put("/alarms/not-a-uuid", "test-secret", { fire_at: "2027-01-01T00:00:00Z" }), env);
    expect(res.status).toBe(400);
  });

  it("400 for invalid json / fire_at", async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(put(`/alarms/${UUID}`, "test-secret"), env)).status).toBe(400);
    expect((await worker.fetch(put(`/alarms/${UUID}`, "test-secret", { fire_at: "later" }), env)).status).toBe(400);
  });
});

describe("forwarding to DO", () => {
  it("PUT forwards normalized schedule_id and epoch fire_at", async () => {
    const { env, namespace, doFetch } = makeEnv();
    const res = await worker.fetch(
      put(`/alarms/${UUID.toUpperCase()}`, "test-secret", { fire_at: "2027-01-01T00:00:00Z" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(namespace.idFromName).toHaveBeenCalledWith(UUID);
    const [url, init] = doFetch.mock.calls[0]!;
    expect(String(url)).toContain("/alarm");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      schedule_id: UUID,
      fire_at: Date.parse("2027-01-01T00:00:00Z"),
    });
  });

  it("DELETE forwards to DO", async () => {
    const { env, doFetch } = makeEnv();
    const req = new Request(`https://alarm.example/alarms/${UUID}`, {
      method: "DELETE",
      headers: { "X-Internal-Shared-Secret": "test-secret" },
    });
    await worker.fetch(req, env);
    const [, init] = doFetch.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
  });
});
