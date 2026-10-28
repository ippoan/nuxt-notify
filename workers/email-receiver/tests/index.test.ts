import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { extractTenantShortId, INGEST_URL, pickRoute, uint8ArrayToBase64 } from "../src/index";

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

/** Service Binding (Fetcher) の代わり。`fetch` の呼び出しを残す */
function makeFetcher(res: Response | Error = new Response(null, { status: 201 })) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    if (res instanceof Error) throw res;
    return res;
  });
  return { fetch } as unknown as Fetcher & { fetch: typeof fetch };
}

function makeEnv(overrides: { prod?: Fetcher | undefined; staging?: Fetcher | undefined } = {}) {
  return {
    NOTIFY: "prod" in overrides ? overrides.prod : makeFetcher(),
    NOTIFY_STAGING: "staging" in overrides ? overrides.staging : makeFetcher(),
  };
}

describe("extractTenantShortId", () => {
  it("extracts short_id from valid local-part", () => {
    expect(extractTenantShortId("tenant-1925a8e1")).toBe("1925a8e1");
    expect(extractTenantShortId("tenant-deadbeef")).toBe("deadbeef");
    // 形式チェックは backend に任せるので、UUID 以外でも raw に通す
    expect(extractTenantShortId("tenant-some-long-slug")).toBe("some-long-slug");
  });

  it("returns null for empty short_id", () => {
    expect(extractTenantShortId("tenant-")).toBeNull();
    expect(extractTenantShortId("tenant-   ")).toBeNull();
  });

  it("returns null without prefix", () => {
    expect(extractTenantShortId("1925a8e1")).toBeNull();
    expect(extractTenantShortId("info")).toBeNull();
    expect(extractTenantShortId("")).toBeNull();
  });
});

describe("pickRoute", () => {
  it("routes notify.ippoan.org to the prod binding", () => {
    const env = makeEnv();
    expect(pickRoute("notify.ippoan.org", env)).toBe(env.NOTIFY);
  });

  it("routes notify-staging.ippoan.org to the staging binding", () => {
    const env = makeEnv();
    expect(pickRoute("notify-staging.ippoan.org", env)).toBe(env.NOTIFY_STAGING);
  });

  it("returns null for unknown host", () => {
    const env = makeEnv();
    expect(pickRoute("ippoan.org", env)).toBeNull();
    expect(pickRoute("evil.example.com", env)).toBeNull();
  });

  it("returns null when the binding for the host is missing", () => {
    expect(pickRoute("notify.ippoan.org", makeEnv({ prod: undefined }))).toBeNull();
    expect(pickRoute("notify-staging.ippoan.org", makeEnv({ staging: undefined }))).toBeNull();
  });

  it("respects PROD_HOST / STAGING_HOST overrides", () => {
    const env = { ...makeEnv(), PROD_HOST: "mail.example.com", STAGING_HOST: "mail-stg.example.com" };
    expect(pickRoute("mail.example.com", env)).toBe(env.NOTIFY);
    expect(pickRoute("mail-stg.example.com", env)).toBe(env.NOTIFY_STAGING);
    expect(pickRoute("notify.ippoan.org", env)).toBeNull();
  });

  it("is case insensitive", () => {
    const env = makeEnv();
    expect(pickRoute("Notify.Ippoan.Org", env)).toBe(env.NOTIFY);
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
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("silently drops when host is unknown", async () => {
    const msg = makeMessage({ to: "tenant-acme@other.example.com" });
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("silently drops when local-part lacks tenant- prefix", async () => {
    const msg = makeMessage({ to: "info@notify.ippoan.org" });
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("silently drops when local-part is just the prefix with empty slug", async () => {
    const msg = makeMessage({ to: "tenant-@notify.ippoan.org" });
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("rejects when MIME parse fails", async () => {
    const msg = makeMessage({ raw: new TextEncoder().encode("\x00not-mime") });
    const PostalMime = (await import("postal-mime")).default;
    const spy = vi
      .spyOn(PostalMime, "parse")
      .mockRejectedValueOnce(new Error("bad"));
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
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
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("forwards prod email to the NOTIFY binding without a shared secret", async () => {
    const env = makeEnv();
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const msg = makeMessage({ to: "tenant-1925a8e1@notify.ippoan.org" });
    await worker.email(msg, env as any, {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(env.NOTIFY_STAGING!.fetch).not.toHaveBeenCalled();
    const [url, init] = (env.NOTIFY as any).fetch.mock.calls[0]!;
    expect(url).toBe(INGEST_URL);
    expect(url).toBe("https://alc-notify/api/notify/ingest");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tenant_short_id).toBe("1925a8e1");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ filename: "a.pdf", content_type: "application/pdf" });
    expect(body.from).toBe("sender@example.com");
  });

  it("forwards staging email to the NOTIFY_STAGING binding", async () => {
    const env = makeEnv();
    const msg = makeMessage({ to: "tenant-acme@notify-staging.ippoan.org" });
    await worker.email(msg, env as any, {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    expect(env.NOTIFY!.fetch).not.toHaveBeenCalled();
    expect((env.NOTIFY_STAGING as any).fetch.mock.calls[0]![0]).toBe(INGEST_URL);
  });

  it("silently drops when the binding is missing", async () => {
    const msg = makeMessage();
    await worker.email(msg, makeEnv({ prod: undefined }) as any, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("rejects when ingest returns non-OK", async () => {
    const env = makeEnv({ prod: makeFetcher(new Response("upstream error", { status: 500 })) });
    const msg = makeMessage();
    await worker.email(msg, env as any, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Ingest failed: 500"),
    );
  });

  it("rejects when the binding fetch throws", async () => {
    const env = makeEnv({ prod: makeFetcher(new Error("network down")) });
    const msg = makeMessage();
    await worker.email(msg, env as any, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Ingest fetch failed"),
    );
  });

  it("rejects when total attachments exceed 25MB", async () => {
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
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith("Attachments exceed 25MB total");
  });
});
