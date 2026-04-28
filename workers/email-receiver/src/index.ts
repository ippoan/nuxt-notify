import PostalMime from "postal-mime";

export interface Env {
  INGEST_ENDPOINT: string;
  INGEST_KEYS_KV: KVNamespace;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const localPart = message.to.split("@")[0]?.toLowerCase();
    if (!localPart) {
      message.setReject("Missing local-part");
      return;
    }

    const ingestKey = await env.INGEST_KEYS_KV.get(localPart);
    if (!ingestKey) {
      message.setReject(`Unknown tenant local-part: ${localPart}`);
      return;
    }

    let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch (e) {
      message.setReject(`MIME parse failed: ${(e as Error).message}`);
      return;
    }

    const attachments = (parsed.attachments ?? []).slice(0, MAX_ATTACHMENTS);
    let totalBytes = 0;
    const encoded: Array<{
      filename: string;
      content_type: string;
      size: number;
      content_base64: string;
    }> = [];
    for (const a of attachments) {
      const filename = a.filename || "attachment";
      const bytes: Uint8Array = a.content instanceof Uint8Array
        ? a.content
        : new Uint8Array(a.content as ArrayBuffer);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        message.setReject("Attachments exceed 25MB total");
        return;
      }
      encoded.push({
        filename,
        content_type: a.mimeType ?? "application/octet-stream",
        size: bytes.byteLength,
        content_base64: uint8ArrayToBase64(bytes),
      });
    }

    if (encoded.length === 0) {
      message.setReject("No attachments");
      return;
    }

    const payload = {
      from: parsed.from?.address ?? null,
      subject: parsed.subject ?? null,
      body_text: parsed.text ?? null,
      body_html: parsed.html ?? null,
      received_at: new Date().toISOString(),
      attachments: encoded,
    };

    let res: Response;
    try {
      res = await fetch(env.INGEST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Key": ingestKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      message.setReject(`Ingest fetch failed: ${(e as Error).message}`);
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      message.setReject(`Ingest failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
  },
};

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
