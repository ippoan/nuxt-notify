// HS256 JWT 検証 (rust-alc-api と同じ JWT_SECRET で署名された tokens を検証)
//
// rust-alc-api の JWT クレーム (`crates/alc-auth-jwt`):
//   { sub, email, name, tenant_id (uuid), role, iat, exp }
// ここでは tenant_id を取り出して DO ルーティング名前空間に使う。
//
// 検証本体は `@ippoan/mcp-cf-workers` の `./auth` export (`verifyHs256Jwt`) を
// 消費する (Refs ippoan/mcp-cf-workers#46 — 自前 Web Crypto コピーの解消)。
// 本 worker の契約 (null-on-fail / tenant_id 必須 / skew なし) は wrapper で維持。
import {
  verifyHs256Jwt,
  Hs256JwtError,
  type Hs256BaseClaims,
} from "@ippoan/mcp-cf-workers/auth";

export interface JwtClaims extends Hs256BaseClaims {
  sub: string;
  tenant_id: string;
  // 他フィールドはこの Worker では使わない
}

/**
 * HS256 JWT を検証して claims を返す。失敗時は null。
 *
 * - 署名検証 (HMAC-SHA256, constant-time 比較) + alg=HS256 pin
 * - exp 期限切れチェック (skew なし — 旧ローカル実装と同じ)
 * - tenant_id 必須
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtClaims | null> {
  try {
    return await verifyHs256Jwt<JwtClaims>(token, secret, {
      clockToleranceSec: 0,
      validateClaims: (c) => {
        if (typeof c.tenant_id !== "string" || !c.tenant_id) {
          throw new Hs256JwtError("tenant_id");
        }
      },
    });
  } catch {
    return null;
  }
}
