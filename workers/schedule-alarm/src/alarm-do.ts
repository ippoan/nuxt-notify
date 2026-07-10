// 予約 1 件 = 1 DO = 1 alarm。idFromName(schedule_id) で選択される。
//
//   - PUT  /alarm  body {schedule_id, fire_at(ms)} — 状態保存 + setAlarm (上書き可)
//   - DELETE /alarm — 状態 + alarm を削除 (冪等)
//   - alarm() — auth-worker (service binding) 経由で rust-alc-api の internal fire を叩く。
//     失敗は backoff retry、上限到達で loud log して破棄する。
//
// fire (rust 側) は status=pending チェック付きの冪等操作なので、DO alarm の
// at-least-once (再実行) と両立する。

import { DurableObject } from "cloudflare:workers";
import {
  backoffMs,
  classifyFireStatus,
  MAX_ATTEMPTS,
  type AlarmState,
} from "./logic";
import { resolveSecret, type SecretBinding } from "./secret";

interface Env {
  SCHEDULE_ALARM: DurableObjectNamespace;
  AUTH_WORKER: Fetcher;
  INTERNAL_SHARED_SECRET: SecretBinding;
}

const STATE_KEY = "state";

export class ScheduleAlarmDO extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/alarm") {
      return new Response("not found", { status: 404 });
    }

    if (req.method === "PUT") {
      let body: { schedule_id?: string; fire_at?: number };
      try {
        body = (await req.json()) as { schedule_id?: string; fire_at?: number };
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      if (!body.schedule_id || typeof body.fire_at !== "number") {
        return new Response("missing fields", { status: 400 });
      }
      const state: AlarmState = {
        schedule_id: body.schedule_id,
        fire_at: body.fire_at,
        attempts: 0,
      };
      await this.ctx.storage.put(STATE_KEY, state);
      // 過去時刻 (登録遅延) は即時発火。setAlarm は既存 alarm を上書きする。
      await this.ctx.storage.setAlarm(Math.max(body.fire_at, Date.now() + 1000));
      return Response.json({ scheduled: true });
    }

    if (req.method === "DELETE") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    return new Response("method not allowed", { status: 405 });
  }

  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<AlarmState>(STATE_KEY);
    if (!state) return; // cancel 済み

    let status = 0;
    try {
      // auth-worker /alc-internal-proxy が OIDC (aud=alc-api-internal) を mint して
      // rust-alc-api の internal fire に forward する。host は service binding の
      // ため任意 (auth-worker 側は path で判定)。consumer proof は既存
      // INTERNAL_SHARED_SECRET の再利用 (専用 secret は持たない)。
      const proxySecret = await resolveSecret(this.env.INTERNAL_SHARED_SECRET);
      const res = await this.env.AUTH_WORKER.fetch(
        `https://auth-worker.internal/alc-internal-proxy/api/internal/trouble/schedules/${state.schedule_id}/fire`,
        {
          method: "POST",
          headers: { "X-Alc-Proxy-Secret": proxySecret ?? "" },
        },
      );
      status = res.status;
    } catch (e) {
      console.error(
        `schedule-alarm fire network error schedule_id=${state.schedule_id}: ${e instanceof Error ? e.message : e}`,
      );
      status = 0; // network error → retry
    }

    if (status !== 0 && classifyFireStatus(status) === "done") {
      console.log(
        `schedule-alarm fired schedule_id=${state.schedule_id} status=${status} attempts=${state.attempts}`,
      );
      await this.ctx.storage.deleteAll();
      return;
    }

    const attempts = state.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // retry 上限。握りつぶさず loud log して破棄 (schedule は rust 側で pending の
      // まま残るので、原因解消後に手動 fire / 再予約で回収できる)。
      console.error(
        `schedule-alarm giving up schedule_id=${state.schedule_id} status=${status} attempts=${attempts}`,
      );
      await this.ctx.storage.deleteAll();
      return;
    }

    console.warn(
      `schedule-alarm retry schedule_id=${state.schedule_id} status=${status} attempts=${attempts}`,
    );
    await this.ctx.storage.put(STATE_KEY, { ...state, attempts });
    await this.ctx.storage.setAlarm(Date.now() + backoffMs(attempts));
  }
}
