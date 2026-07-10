import PostalMime from "postal-mime";

import { resolveSecret, type SecretBinding } from "./secret";

export interface Env {
  /** 本番 ingest エンドポイント (notify.ippoan.org 用) */
  INGEST_ENDPOINT: string;
  /** 本番 backend と共有する shared secret (CF Secrets Store binding —
   *  wrangler 4 では { get(): Promise<string> } オブジェクト、Refs #105) */
  NOTIFY_WORKER_SECRET: SecretBinding;

  /** staging ingest エンドポイント (notify-staging.ippoan.org 用、任意) */
  INGEST_ENDPOINT_STAGING?: string;
  /** staging backend と共有する shared secret (任意、staging host を受ける時のみ必要) */
  NOTIFY_WORKER_SECRET_STAGING?: SecretBinding;

  /** 本番ホスト名 (デフォルト notify.ippoan.org) */
  PROD_HOST?: string;
  /** staging ホスト名 (デフォルト notify-staging.ippoan.org) */
  STAGING_HOST?: string;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

interface RouteTarget {
  endpoint: string;
  secret: string;
}

/** pickRoute には secret を string に解決済みの env を渡す (pure に保ちテスト可能に)。 */
export type ResolvedSecretsEnv = Omit<Env, "NOTIFY_WORKER_SECRET" | "NOTIFY_WORKER_SECRET_STAGING"> & {
  NOTIFY_WORKER_SECRET: string;
  NOTIFY_WORKER_SECRET_STAGING?: string;
};

export function pickRoute(host: string, env: ResolvedSecretsEnv): RouteTarget | null {
  const prodHost = (env.PROD_HOST ?? "notify.ippoan.org").toLowerCase();
  const stagingHost = (env.STAGING_HOST ?? "notify-staging.ippoan.org").toLowerCase();
  const h = host.toLowerCase();
  if (h === prodHost && env.INGEST_ENDPOINT && env.NOTIFY_WORKER_SECRET) {
    return { endpoint: env.INGEST_ENDPOINT, secret: env.NOTIFY_WORKER_SECRET };
  }
  if (
    h === stagingHost &&
    env.INGEST_ENDPOINT_STAGING &&
    env.NOTIFY_WORKER_SECRET_STAGING
  ) {
    return {
      endpoint: env.INGEST_ENDPOINT_STAGING,
      secret: env.NOTIFY_WORKER_SECRET_STAGING,
    };
  }
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

    // host → (endpoint, secret) を選択。未対応 host は silent drop。
    // Secrets Store binding を string に解決してから pure な pickRoute に渡す。
    const route = pickRoute(host, {
      ...env,
      NOTIFY_WORKER_SECRET: (await resolveSecret(env.NOTIFY_WORKER_SECRET)) ?? "",
      NOTIFY_WORKER_SECRET_STAGING:
        (await resolveSecret(env.NOTIFY_WORKER_SECRET_STAGING)) ?? undefined,
    });
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
      res = await fetch(route.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": route.secret,
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
