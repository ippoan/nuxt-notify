// notify-realtime-bus Worker — エントリポイント。
//
// 2 つのエンドポイント:
//   POST /broadcast   — rust-alc-api からの terminal status push (X-Broadcast-Secret 検証)
//   GET  /subscribe   — ブラウザからの WebSocket upgrade (Sec-WebSocket-Protocol "bearer,<jwt>")
//
// どちらも tenant_id をキーに DurableObject を選択し、DO 内の WebSocket fan-out に委譲する。
// DO 自体は `redact-bus.ts` の `RedactBus` クラスで hibernation 対応。

import { RedactBus } from "./redact-bus";
import { verifyJwt } from "./jwt";

export { RedactBus };

interface Env {
  REDACT_BUS: DurableObjectNamespace;
  JWT_SECRET: string;
  NOTIFY_REDACT_BROADCAST_SECRET: string;
}

interface BroadcastPayload {
  tenant_id: string;
  document_id: string;
  status: string;
  redactions_applied?: number;
  redaction_error?: string;
}

function constantTimeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sec-WebSocket-Protocol ヘッダから JWT を抽出する。
 * 想定形式: `bearer, <jwt>` (= `new WebSocket(url, ['bearer', jwt])` で送信)。
 */
export function extractBearerToken(protocolHeader: string | null): string | null {
  if (!protocolHeader) return null;
  const parts = protocolHeader.split(",").map((s) => s.trim());
  if (parts.length < 2) return null;
  if (parts[0] !== "bearer") return null;
  if (!parts[1]) return null;
  return parts[1];
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // --- /broadcast (rust-alc-api → DO fan-out) ---
    if (url.pathname === "/broadcast" && req.method === "POST") {
      const provided = req.headers.get("X-Broadcast-Secret") ?? "";
      const expected = env.NOTIFY_REDACT_BROADCAST_SECRET ?? "";
      if (!expected || !constantTimeEqualStr(provided, expected)) {
        return new Response("invalid signature", { status: 401 });
      }

      let payload: BroadcastPayload;
      try {
        payload = (await req.json()) as BroadcastPayload;
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      if (!payload.tenant_id || !payload.document_id || !payload.status) {
        return new Response("missing fields", { status: 400 });
      }

      const id = env.REDACT_BUS.idFromName(payload.tenant_id);
      const stub = env.REDACT_BUS.get(id);
      // DO の /dispatch は内部 URL で識別 (host は何でも良い)
      return stub.fetch("https://internal.invalid/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    // --- /subscribe (admin browser → DO WS) ---
    if (url.pathname === "/subscribe") {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const proto = req.headers.get("Sec-WebSocket-Protocol");
      const token = extractBearerToken(proto);
      if (!token) return new Response("missing bearer token", { status: 401 });

      const claims = await verifyJwt(token, env.JWT_SECRET);
      if (!claims) return new Response("invalid token", { status: 401 });

      const id = env.REDACT_BUS.idFromName(claims.tenant_id);
      const stub = env.REDACT_BUS.get(id);
      return stub.fetch(req);
    }

    return new Response("not found", { status: 404 });
  },
};
