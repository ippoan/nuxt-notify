import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleAlarmDO } from "../src/alarm-do";
import { MAX_ATTEMPTS } from "../src/logic";

const UUID = "61cf27f0-b192-4ca4-a608-1cc1b24f45c3";

function makeCtx() {
  const store = new Map<string, unknown>();
  let alarmAt: number | null = null;
  return {
    storage: {
      get: vi.fn(async (k: string) => store.get(k)),
      put: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
      deleteAll: vi.fn(async () => void store.clear()),
      deleteAlarm: vi.fn(async () => void (alarmAt = null)),
      setAlarm: vi.fn(async (t: number) => void (alarmAt = t)),
    },
    inspect: { store, alarmAt: () => alarmAt },
  };
}

function makeDo(fireStatus: number | Error) {
  const ctx = makeCtx();
  const authFetch = vi.fn(async () => {
    if (fireStatus instanceof Error) throw fireStatus;
    return new Response(null, { status: fireStatus });
  });
  const env = {
    AUTH_WORKER: { fetch: authFetch },
    INTERNAL_SHARED_SECRET: "proxy-secret",
  } as any;
  const dobj = new (ScheduleAlarmDO as any)(ctx, env) as ScheduleAlarmDO;
  return { dobj, ctx, authFetch };
}

async function register(dobj: ScheduleAlarmDO, fireAt: number) {
  const res = await dobj.fetch(
    new Request("https://internal.invalid/alarm", {
      method: "PUT",
      body: JSON.stringify({ schedule_id: UUID, fire_at: fireAt }),
    }),
  );
  expect(res.status).toBe(200);
}

describe("ScheduleAlarmDO fetch", () => {
  it("PUT stores state and sets alarm at fire_at", async () => {
    const { dobj, ctx } = makeDo(200);
    const future = Date.now() + 60_000;
    await register(dobj, future);
    expect(ctx.storage.setAlarm).toHaveBeenCalledWith(future);
    expect(ctx.inspect.store.get("state")).toMatchObject({ schedule_id: UUID, attempts: 0 });
  });

  it("PUT with past fire_at clamps to near-now (immediate fire)", async () => {
    const { dobj, ctx } = makeDo(200);
    await register(dobj, 1000);
    const set = ctx.storage.setAlarm.mock.calls[0]![0] as number;
    expect(set).toBeGreaterThan(Date.now() - 1000);
  });

  it("PUT rejects bad body", async () => {
    const { dobj } = makeDo(200);
    const bad = await dobj.fetch(new Request("https://internal.invalid/alarm", { method: "PUT", body: "x" }));
    expect(bad.status).toBe(400);
    const missing = await dobj.fetch(
      new Request("https://internal.invalid/alarm", { method: "PUT", body: JSON.stringify({}) }),
    );
    expect(missing.status).toBe(400);
  });

  it("DELETE clears alarm and state (idempotent)", async () => {
    const { dobj, ctx } = makeDo(200);
    await register(dobj, Date.now() + 60_000);
    const res = await dobj.fetch(new Request("https://internal.invalid/alarm", { method: "DELETE" }));
    expect(res.status).toBe(204);
    expect(ctx.storage.deleteAlarm).toHaveBeenCalled();
    expect(ctx.inspect.store.size).toBe(0);
    // 未登録でも 204
    const again = await dobj.fetch(new Request("https://internal.invalid/alarm", { method: "DELETE" }));
    expect(again.status).toBe(204);
  });

  it("404 for unknown path / 405 for unknown method", async () => {
    const { dobj } = makeDo(200);
    expect((await dobj.fetch(new Request("https://internal.invalid/x", { method: "PUT" }))).status).toBe(404);
    expect((await dobj.fetch(new Request("https://internal.invalid/alarm", { method: "POST" }))).status).toBe(405);
  });
});

describe("ScheduleAlarmDO alarm()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no-op when state missing (cancelled)", async () => {
    const { dobj, authFetch } = makeDo(200);
    await dobj.alarm();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("fires via auth-worker with proxy secret and cleans up on 200", async () => {
    const { dobj, ctx, authFetch } = makeDo(200);
    await register(dobj, Date.now() + 60_000);
    await dobj.alarm();
    const [url, init] = authFetch.mock.calls[0]!;
    expect(String(url)).toContain(`/alc-internal-proxy/api/internal/trouble/schedules/${UUID}/fire`);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as any).headers["X-Alc-Proxy-Secret"]).toBe("proxy-secret");
    expect(ctx.inspect.store.size).toBe(0);
  });

  it("treats 404 as done (schedule gone)", async () => {
    const { dobj, ctx } = makeDo(404);
    await register(dobj, Date.now() + 60_000);
    await dobj.alarm();
    expect(ctx.inspect.store.size).toBe(0);
  });

  it("retries with backoff on 503 and increments attempts", async () => {
    const { dobj, ctx } = makeDo(503);
    await register(dobj, Date.now() + 60_000);
    await dobj.alarm();
    expect(ctx.inspect.store.get("state")).toMatchObject({ attempts: 1 });
    // register 時 + retry 時の 2 回目の setAlarm
    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(2);
  });

  it("retries on network error", async () => {
    const { dobj, ctx } = makeDo(new Error("boom"));
    await register(dobj, Date.now() + 60_000);
    await dobj.alarm();
    expect(ctx.inspect.store.get("state")).toMatchObject({ attempts: 1 });
  });

  it("gives up loudly after MAX_ATTEMPTS", async () => {
    const { dobj, ctx } = makeDo(503);
    await register(dobj, Date.now() + 60_000);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) await dobj.alarm();
    expect(ctx.inspect.store.size).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    // 破棄後はもう発火しない
    await dobj.alarm();
    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(MAX_ATTEMPTS); // register 1 + retry (MAX-1)
  });
});
