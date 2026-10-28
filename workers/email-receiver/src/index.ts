import PostalMime from "postal-mime";

export interface Env {
  /** 本番 host (notify.ippoan.org) の取り込み先: ippoan/alc-notify-worker の Service Binding (`alc-notify`) */
  NOTIFY?: Fetcher;
  /** staging host (notify-staging.ippoan.org) の取り込み先: `alc-notify-staging` の Service Binding (任意) */
  NOTIFY_STAGING?: Fetcher;

  /** 本番ホスト名 (デフォルト notify.ippoan.org) */
  PROD_HOST?: string;
  /** staging ホスト名 (デフォルト notify-staging.ippoan.org) */
  STAGING_HOST?: string;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

/**
 * 取り込みの口 (alc-notify-worker の `POST /api/notify/ingest`)。host は名目の値 (Service Binding は host で経路が決まらない)。
 * 呼び手の認証は Service Binding だけ (共有の秘密 `X-Worker-Secret` は廃止。W8c-2、Refs ippoan/rust-alc-api#680)。
 * notify-worker は workers.dev も route も持たず、auth-worker の振り分け表にも ingest は載らないので、届くのはこの binding だけ。
 */
export const INGEST_URL = "https://alc-notify/api/notify/ingest";

/** 宛先の host から取り込み先の binding を選ぶ。未対応の host・binding が無い env は null (silent drop)。 */
export function pickRoute(host: string, env: Env): Fetcher | null {
  const prodHost = (env.PROD_HOST ?? "notify.ippoan.org").toLowerCase();
  const stagingHost = (env.STAGING_HOST ?? "notify-staging.ippoan.org").toLowerCase();
  const h = host.toLowerCase();
  if (h === prodHost && env.NOTIFY) return env.NOTIFY;
  if (h === stagingHost && env.NOTIFY_STAGING) return env.NOTIFY_STAGING;
  return null;
}

/**
 * `tenant-{short_id}` 形式の local-part から `tenants.short_id` (8 文字 hex) を抜き出す。
 * - `tenant-1925a8e1` → `1925a8e1`
 * - `tenant-` (空) → null
 * - `1925a8e1` (プレフィクス無し) → null
 *
 * 形式が変でも backend が `tenants.short_id = $1` で 0 件にすれば silent drop に
 * なるので、ここでは長さの厳密チェックはしない (tenant-default 等の
 * 旧 slug 形式も後方互換で受け付け、backend が見つけられなければ 404)。
 */
export function extractTenantShortId(localPart: string): string | null {
  const PREFIX = "tenant-";
  if (!localPart.startsWith(PREFIX)) return null;
  const id = localPart.slice(PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const [localPartRaw, hostRaw] = message.to.split("@");
    const localPart = localPartRaw?.toLowerCase();
    const host = hostRaw?.toLowerCase();
    if (!localPart || !host) {
      return;
    }

    // host → 取り込み先の binding を選択。未対応 host は silent drop。
    const route = pickRoute(host, env);
    if (!route) {
      return;
    }

    // local-part `tenant-{short_id}` から短縮 ID を抽出。バウンスは From 偽装
    // で第三者に送られうるので silent drop。
    const tenantShortId = extractTenantShortId(localPart);
    if (!tenantShortId) {
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
      return;
    }

    const payload = {
      tenant_short_id: tenantShortId,
      from: parsed.from?.address ?? null,
      subject: parsed.subject ?? null,
      body_text: parsed.text ?? null,
      body_html: parsed.html ?? null,
      received_at: new Date().toISOString(),
      attachments: encoded,
    };

    let res: Response;
    try {
      res = await route.fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
