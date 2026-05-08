// HS256 JWT 検証 (rust-alc-api と同じ JWT_SECRET で署名された tokens を検証)
//
// rust-alc-api の JWT クレーム (`crates/alc-core/src/auth_jwt.rs`):
//   { sub, email, name, tenant_id (uuid), role, iat, exp }
// ここでは tenant_id を取り出して DO ルーティング名前空間に使う。

export interface JwtClaims {
  sub: string;
  tenant_id: string;
  exp: number;
  // 他フィールドはこの Worker では使わない
  [key: string]: unknown;
}

const enc = new TextEncoder();

function base64UrlDecode(s: string): Uint8Array {
  // base64url → base64 に変換 (`-`/`_` を `+`/`/` に置換、padding 追加)
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * HS256 JWT を検証して claims を返す。失敗時は null。
 *
 * - 署名検証 (HMAC-SHA256, constant-time 比較)
 * - exp 期限切れチェック (現時刻 ≤ exp)
 * - tenant_id 必須
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // 1. 署名検証
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${headerB64}.${payloadB64}`)),
  );
  const provided = base64UrlDecode(sigB64);
  if (!constantTimeEqual(expected, provided)) return null;

  // 2. payload parse
  let claims: JwtClaims;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    claims = JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }

  // 3. 期限チェック (exp は UNIX 秒)
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) return null;

  // 4. tenant_id 必須
  if (typeof claims.tenant_id !== "string" || !claims.tenant_id) return null;

  return claims;
}
