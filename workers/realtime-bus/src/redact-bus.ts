// Per-tenant Durable Object — hibernatable WebSocket fan-out。
//
// 構造:
//   - tenant_id ごとに 1 DO (idFromName(tenant_id))
//   - admin が `wss://realtime.notify.../subscribe` で接続 → DO にルーティング
//   - rust-alc-api が `POST /broadcast` で送ってくる JSON を /dispatch 経由で fan-out
//   - `ctx.acceptWebSocket()` で hibernation API を有効化 (idle 中の CPU 課金ゼロ)
//
// JS-Workers DO の hibernation 仕様:
//   https://developers.cloudflare.com/durable-objects/api/websockets/

import { DurableObject } from "cloudflare:workers";

import type { SecretBinding } from "./secret";

interface Env {
  REDACT_BUS: DurableObjectNamespace;
  JWT_SECRET: string;
  NOTIFY_REDACT_BROADCAST_SECRET: SecretBinding;
}

export class RedactBus extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/dispatch" && req.method === "POST") {
      return this.dispatch(req);
    }
    if (req.headers.get("Upgrade") === "websocket") {
      return this.handleConnect(req);
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * ブラウザからの WebSocket upgrade。
   * `acceptWebSocket()` で hibernation API に登録 → idle 中も WS 状態が DO storage に保持される。
   */
  private async handleConnect(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      // Sec-WebSocket-Protocol で `bearer` を ack (ブラウザ仕様)
      headers: { "Sec-WebSocket-Protocol": "bearer" },
    });
  }

  /**
   * rust-alc-api からの broadcast を全 hibernated WS に fan-out する。
   * 接続中ソケットがゼロでも 200 を返す (DO 起動コストの吸収のみ)。
   */
  private async dispatch(req: Request): Promise<Response> {
    const text = await req.text();
    const sockets = this.ctx.getWebSockets();
    let delivered = 0;
    for (const ws of sockets) {
      try {
        ws.send(text);
        delivered++;
      } catch {
        // closed socket は無視 (hibernation 復元中の race など)
      }
    }
    return Response.json({ delivered });
  }

  // hibernation コールバック: 既定の no-op で十分 (storage 操作なし、tag なし)
  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}
