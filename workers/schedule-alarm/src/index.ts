// notify-schedule-alarm Worker — エントリポイント。
//
// rust-alc-api (trouble_schedules) の通知予約を指定時刻に発火させる DO Alarm 基盤
// (Refs ippoan/rust-alc-api#550, ippoan/nuxt-notify#102)。
//
//   PUT    /alarms/{schedule_id}  body {"fire_at": "<RFC3339>"} — alarm 登録 (上書き可)
//   DELETE /alarms/{schedule_id}                                — alarm 解除 (冪等)
//
// 認証: X-Internal-Shared-Secret を INTERNAL_SHARED_SECRET (CF Secrets Store binding、
// rust-alc-api の同名 env と物理共有) と constant-time 比較。未設定は fail-closed (503)。
// 専用 secret は持たない (既存 INTERNAL_SHARED_SECRET 再利用、Refs ippoan/rust-alc-api#550)。
// 発火時の fire 呼び出しは alarm-do.ts が auth-worker service binding に委譲する。

import { ScheduleAlarmDO } from "./alarm-do";
import { constantTimeEqualStr, isValidUuid, parseFireAt } from "./logic";

export { ScheduleAlarmDO };

interface Env {
  SCHEDULE_ALARM: DurableObjectNamespace;
  AUTH_WORKER: Fetcher;
  INTERNAL_SHARED_SECRET: string;
}

const ALARMS_PREFIX = "/alarms/";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith(ALARMS_PREFIX)) {
      return new Response("not found", { status: 404 });
    }
    if (req.method !== "PUT" && req.method !== "DELETE") {
      return new Response("method not allowed", { status: 405 });
    }

    // --- 認証 (fail-closed) ---
    const expected = env.INTERNAL_SHARED_SECRET ?? "";
    if (!expected) {
      return new Response("secret not configured", { status: 503 });
    }
    const provided = req.headers.get("X-Internal-Shared-Secret") ?? "";
    if (!constantTimeEqualStr(provided, expected)) {
      return new Response("unauthorized", { status: 401 });
    }

    const scheduleId = url.pathname.slice(ALARMS_PREFIX.length);
    if (!isValidUuid(scheduleId)) {
      return new Response("invalid schedule id", { status: 400 });
    }

    const id = env.SCHEDULE_ALARM.idFromName(scheduleId.toLowerCase());
    const stub = env.SCHEDULE_ALARM.get(id);

    if (req.method === "PUT") {
      let body: { fire_at?: unknown };
      try {
        body = (await req.json()) as { fire_at?: unknown };
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      const fireAt = parseFireAt(body.fire_at);
      if (fireAt === null) {
        return new Response("invalid fire_at", { status: 400 });
      }
      return stub.fetch("https://internal.invalid/alarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_id: scheduleId.toLowerCase(), fire_at: fireAt }),
      });
    }

    // DELETE
    return stub.fetch("https://internal.invalid/alarm", { method: "DELETE" });
  },
};
