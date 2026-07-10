// schedule-alarm の pure ロジック (DO / fetch から分離して unit test 可能にする)。

/** UUID (v4 想定だが version は問わない) の形式検証。 */
export function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * fire_at (RFC3339) を epoch ms にパースする。不正なら null。
 * 過去時刻は reject しない (rust-alc-api 側で未来を検証済み。alarm 側では
 * 「登録が遅延して過去になった」ケースを即時発火として扱うため許容する)。
 */
export function parseFireAt(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function constantTimeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** retry 上限 (初回 + retry MAX_ATTEMPTS 回で打ち切り)。 */
export const MAX_ATTEMPTS = 5;

/**
 * attempts 回目の失敗後に待つ backoff (ms)。1m → 5m → 15m → 30m → 60m。
 * 範囲外は最終値で clamp。
 */
export function backoffMs(attempts: number): number {
  const table = [60_000, 300_000, 900_000, 1_800_000, 3_600_000];
  const i = Math.min(Math.max(attempts, 1), table.length) - 1;
  return table[i]!;
}

/**
 * fire 応答の分類。
 * - 2xx: 送信完了 (非 pending も rust 側が 200 で吸収する)
 * - 404: schedule が消えている → retry しても無意味なので done 扱い
 * - それ以外 (401/403/5xx/ネットワーク): retry
 */
export function classifyFireStatus(status: number): "done" | "retry" {
  if (status >= 200 && status < 300) return "done";
  if (status === 404) return "done";
  return "retry";
}

/** DO storage に置く alarm 状態。 */
export interface AlarmState {
  schedule_id: string;
  fire_at: number;
  attempts: number;
}
