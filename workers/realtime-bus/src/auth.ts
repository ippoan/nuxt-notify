// /broadcast の X-Broadcast-Secret の照合 (index.ts から切り出した純粋な関数。tests/auth.test.ts)。
//
// 401 の理由を固定の語で返す (Refs ippoan/rust-alc-api#680 W8c-2)。呼び手はこの語だけをログに出す
// (secret の値・長さは出さない):
//   - secret_unset: Secrets Store の値が取れない (binding が無い / get() が null・throw = resolveSecret が null)
//   - mismatch:     値は取れたが、送られてきたヘッダーと一致しない
// 照合は長さ込みの完全一致 (trim はしない。前後の空白・改行の扱いはまだ決めていない)。

export type BroadcastAuth = "ok" | "secret_unset" | "mismatch";

export function constantTimeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkBroadcastAuth(provided: string, expected: string | null): BroadcastAuth {
  if (!expected) return "secret_unset";
  return constantTimeEqualStr(provided, expected) ? "ok" : "mismatch";
}
