import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { isHostAllowed, uint8ArrayToBase64 } from "../src/index";

function makeMessage(overrides: Partial<{
  to: string;
  raw: ReadableStream<Uint8Array> | Uint8Array;
}> = {}) {
  const setReject = vi.fn();
  const raw = overrides.raw ?? new TextEncoder().encode(
    [
      "From: sender@example.com",
      "To: tenant-acme@notify.ippoan.org",
      "Subject: Test",
      "Content-Type: multipart/mixed; boundary=B",
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "Hello",
      "--B",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment; filename=\"a.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKJSVFT0Y=",
      "--B--",
      "",
    ].join("\r\n"),
  );

  return {
    to: overrides.to ?? "tenant-acme@notify.ippoan.org",
    raw,
    setReject,
  } as unknown as ForwardableEmailMessage & { setReject: typeof setReject };
}

function makeEnv(overrides: Partial<{
  INGEST_ENDPOINT: string;
  kvValue: string | null;
}> = {}) {
  const kv = {
    get: vi.fn().mockResolvedValue(overrides.kvValue === undefined ? "test-ingest-key" : overrides.kvValue),
  };
  return {
    INGEST_ENDPOINT: overrides.INGEST_ENDPOINT ?? "https://example.invalid/api/notify/ingest",
    INGEST_KEYS_KV: kv as unknown as KVNamespace,
  };
}

describe("isHostAllowed", () => {
  it("returns true when ALLOWED_HOSTS is undefined", () => {
    expect(isHostAllowed("any.example.com")).toBe(true);
  });

  it("matches single host", () => {
    expect(isHostAllowed("notify.ippoan.org", "notify.ippoan.org")).toBe(true);
    expect(isHostAllowed("evil.com", "notify.ippoan.org")).toBe(false);
  });

  it("matches comma-separated host list with whitespace", () => {
    const list = " notify.ippoan.org , notify-staging.ippoan.org ";
    expect(isHostAllowed("notify.ippoan.org", list)).toBe(true);
    expect(isHostAllowed("notify-staging.ippoan.org", list)).toBe(true);
    expect(isHostAllowed("ippoan.org", list)).toBe(false);
  });

  it("is case insensitive on host", () => {
    expect(isHostAllowed("Notify.Ippoan.Org", "notify.ippoan.org")).toBe(true);
  });
});

describe("uint8ArrayToBase64", () => {
  it("encodes empty bytes to empty string", () => {
    expect(uint8ArrayToBase64(new Uint8Array(0))).toBe("");
  });

  it("encodes ASCII bytes correctly", () => {
    expect(uint8ArrayToBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  });

  it("handles large buffers in chunks", () => {
    const bytes = new Uint8Array(0x10000).fill(0x41);
    const result = uint8ArrayToBase64(bytes);
    expect(result.length).toBeGreaterThan(0);
    expect(atob(result)).toHaveLength(0x10000);
  });
});

describe("email worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("silently drops when local-part is missing", async () => {
    const msg = makeMessage({ to: "@notify.ippoan.org" });
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("silently drops when host is not in ALLOWED_HOSTS", async () => {
    const msg = makeMessage({ to: "tenant-acme@other.example.com" });
    const env = makeEnv();
    (env as any).ALLOWED_HOSTS = "notify.ippoan.org";
    await worker.email(msg, env, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("silently drops when KV has no key for tenant", async () => {
    const msg = makeMessage();
    await worker.email(msg, makeEnv({ kvValue: null }), {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("rejects when MIME parse fails", async () => {
    const msg = makeMessage({ raw: new TextEncoder().encode("\x00not-mime") });
    // postal-mime is forgiving — to force failure we patch parse
    const PostalMime = (await import("postal-mime")).default;
    const spy = vi
      .spyOn(PostalMime, "parse")
      .mockRejectedValueOnce(new Error("bad"));
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(spy).toHaveBeenCalled();
    expect(msg.setReject).toHaveBeenCalledWith(expect.stringContaining("MIME parse failed"));
  });

  it("silently drops when no attachments are present", async () => {
    const raw = new TextEncoder().encode(
      [
        "From: sender@example.com",
        "To: tenant-acme@notify.ippoan.org",
        "Subject: hi",
        "",
        "no attachments",
        "",
      ].join("\r\n"),
    );
    const msg = makeMessage({ raw });
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("forwards parsed payload to ingest endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const msg = makeMessage();
    await worker.email(msg, makeEnv(), {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://example.invalid/api/notify/ingest");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Ingest-Key"]).toBe("test-ingest-key");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe("a.pdf");
    expect(body.from).toBe("sender@example.com");
  });

  it("rejects when ingest endpoint returns non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 500 }),
    );
    const msg = makeMessage();
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Ingest failed: 500"),
    );
  });

  it("rejects when fetch itself throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const msg = makeMessage();
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Ingest fetch failed"),
    );
  });

  it("rejects when total attachments exceed 25MB", async () => {
    // Inject parsed object with one huge attachment via PostalMime mock
    const PostalMime = (await import("postal-mime")).default;
    vi.spyOn(PostalMime, "parse").mockResolvedValueOnce({
      from: { address: "a@b" },
      subject: "x",
      text: null,
      html: null,
      attachments: [
        {
          filename: "huge.bin",
          mimeType: "application/octet-stream",
          content: new Uint8Array(26 * 1024 * 1024),
        },
      ],
    } as any);
    const msg = makeMessage();
    await worker.email(msg, makeEnv(), {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith("Attachments exceed 25MB total");
  });
});
