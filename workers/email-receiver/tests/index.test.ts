import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { extractTenantSlug, pickRoute, uint8ArrayToBase64 } from "../src/index";

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

function makeEnv(overrides: {
  prodEndpoint?: string;
  prodSecret?: string;
  stagingEndpoint?: string;
  stagingSecret?: string;
} = {}) {
  return {
    INGEST_ENDPOINT: overrides.prodEndpoint ?? "https://prod.invalid/api/notify/ingest",
    NOTIFY_WORKER_SECRET: overrides.prodSecret ?? "PROD_SECRET",
    INGEST_ENDPOINT_STAGING: overrides.stagingEndpoint ?? "https://staging.invalid/api/notify/ingest",
    NOTIFY_WORKER_SECRET_STAGING: overrides.stagingSecret ?? "STAGING_SECRET",
  };
}

describe("extractTenantSlug", () => {
  it("extracts slug from valid local-part", () => {
    expect(extractTenantSlug("tenant-acme")).toBe("acme");
    expect(extractTenantSlug("tenant-some-long-slug")).toBe("some-long-slug");
  });

  it("returns null for empty slug", () => {
    expect(extractTenantSlug("tenant-")).toBeNull();
    expect(extractTenantSlug("tenant-   ")).toBeNull();
  });

  it("returns null without prefix", () => {
    expect(extractTenantSlug("acme")).toBeNull();
    expect(extractTenantSlug("info")).toBeNull();
    expect(extractTenantSlug("")).toBeNull();
  });
});

describe("pickRoute", () => {
  it("routes notify.ippoan.org to prod", () => {
    const env = makeEnv();
    const r = pickRoute("notify.ippoan.org", env as any);
    expect(r?.endpoint).toBe("https://prod.invalid/api/notify/ingest");
    expect(r?.secret).toBe("PROD_SECRET");
  });

  it("routes notify-staging.ippoan.org to staging", () => {
    const env = makeEnv();
    const r = pickRoute("notify-staging.ippoan.org", env as any);
    expect(r?.endpoint).toBe("https://staging.invalid/api/notify/ingest");
    expect(r?.secret).toBe("STAGING_SECRET");
  });

  it("returns null for unknown host", () => {
    const env = makeEnv();
    expect(pickRoute("ippoan.org", env as any)).toBeNull();
    expect(pickRoute("evil.example.com", env as any)).toBeNull();
  });

  it("prod routing requires both endpoint and secret", () => {
    const env: any = {
      INGEST_ENDPOINT: "",
      NOTIFY_WORKER_SECRET: "x",
    };
    expect(pickRoute("notify.ippoan.org", env)).toBeNull();
    const env2: any = {
      INGEST_ENDPOINT: "https://prod.invalid",
      NOTIFY_WORKER_SECRET: "",
    };
    expect(pickRoute("notify.ippoan.org", env2)).toBeNull();
  });

  it("staging routing requires both endpoint and secret", () => {
    const env: any = {
      INGEST_ENDPOINT: "https://prod.invalid",
      NOTIFY_WORKER_SECRET: "x",
      // INGEST_ENDPOINT_STAGING / NOTIFY_WORKER_SECRET_STAGING 未設定
    };
    expect(pickRoute("notify-staging.ippoan.org", env)).toBeNull();
  });

  it("respects PROD_HOST / STAGING_HOST overrides", () => {
    const env: any = {
      INGEST_ENDPOINT: "https://prod.invalid",
      NOTIFY_WORKER_SECRET: "p",
      INGEST_ENDPOINT_STAGING: "https://stg.invalid",
      NOTIFY_WORKER_SECRET_STAGING: "s",
      PROD_HOST: "mail.example.com",
      STAGING_HOST: "mail-stg.example.com",
    };
    expect(pickRoute("mail.example.com", env)?.endpoint).toBe("https://prod.invalid");
    expect(pickRoute("mail-stg.example.com", env)?.endpoint).toBe("https://stg.invalid");
    expect(pickRoute("notify.ippoan.org", env)).toBeNull();
  });

  it("is case insensitive", () => {
    const env = makeEnv();
    expect(pickRoute("Notify.Ippoan.Org", env as any)?.endpoint).toBe("https://prod.invalid/api/notify/ingest");
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

  it("forwards prod email with tenant_slug + prod secret", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const msg = makeMessage({ to: "tenant-acme@notify.ippoan.org" });
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://prod.invalid/api/notify/ingest");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Worker-Secret": "PROD_SECRET",
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tenant_slug).toBe("acme");
    expect(body.attachments).toHaveLength(1);
    expect(body.from).toBe("sender@example.com");
  });

  it("forwards staging email with staging secret", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const msg = makeMessage({ to: "tenant-acme@notify-staging.ippoan.org" });
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://staging.invalid/api/notify/ingest");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Worker-Secret": "STAGING_SECRET",
    });
  });

  it("rejects when ingest endpoint returns non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 500 }),
    );
    const msg = makeMessage();
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith(
      expect.stringContaining("Ingest failed: 500"),
    );
  });

  it("rejects when fetch itself throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const msg = makeMessage();
    await worker.email(msg, makeEnv() as any, {} as ExecutionContext);
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
