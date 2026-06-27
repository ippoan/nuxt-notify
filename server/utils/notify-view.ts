/**
 * 公開 viewer (lockdown 後) を Worker + KV + R2 だけで完結させるための純粋ロジック。
 *
 * 設計 (Refs ippoan/rust-alc-api#434):
 * - `view:{token}` … r2_key + メタ。**TTL = リンク失効**。配信用、使い捨て
 * - `read:{tenant_id}:{document_id}:{recipient_id}` … 既読。**TTL なし = 恒久**。
 *   file (tenant×doc×recipient) キーなので token (view) 失効と無関係に既読履歴が残り、
 *   tenant prefix でサーバ側テナント分離できる
 *
 * runtime で rust/auth-worker を呼ばない。rust は distribute 時に register endpoint
 * 経由で `view:{token}` を書くだけ。
 *
 * ここには KV/R2/H3 に依存しない pure function だけを置く (vitest 100% gate 対象)。
 */

/** KV に格納する view レコード (配信用、TTL あり)。 */
export interface ViewRecord {
  r2_key: string
  tenant_id: string
  document_id: string
  recipient_id: string
  file_name: string | null
  file_size_bytes: number | null
  source_subject: string | null
  source_sender: string | null
  source_received_at: string | null
  /** ISO8601。リンク失効時刻。 */
  expire_at: string
}

/** viewer ページに返す公開メタ (r2_key / 内部 id は出さない)。 */
export interface ViewMetadata {
  file_name: string | null
  file_size_bytes: number | null
  source_subject: string | null
  source_sender: string | null
  source_received_at: string | null
  expire_at: string
}

/** 既読レコード (恒久、file×recipient キー)。 */
export interface ReadRecord {
  read_at: string
  recipient_id: string
}

export function viewKey(token: string): string {
  return `view:${token}`
}

export function readKey(tenantId: string, documentId: string, recipientId: string): string {
  return `read:${tenantId}:${documentId}:${recipientId}`
}

/** read:{tenant_id}:{document_id}: prefix (管理画面が tenant scope で document 単位の
 *  既読を list する用。KV multi-tenant の定石 = tenant prefix でサーバ側分離)。 */
export function readKeyPrefix(tenantId: string, documentId: string): string {
  return `read:${tenantId}:${documentId}:`
}

/**
 * register endpoint の body を検証して ViewRecord にする。
 * 必須フィールド (r2_key / document_id / recipient_id / expire_at) が欠けたら null。
 */
export function parseRegisterBody(body: unknown): ViewRecord | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  const r2_key = str(b.r2_key)
  const tenant_id = str(b.tenant_id)
  const document_id = str(b.document_id)
  const recipient_id = str(b.recipient_id)
  const expire_at = str(b.expire_at)
  if (!r2_key || !tenant_id || !document_id || !recipient_id || !expire_at) return null
  return {
    r2_key,
    tenant_id,
    document_id,
    recipient_id,
    file_name: typeof b.file_name === 'string' ? b.file_name : null,
    file_size_bytes: typeof b.file_size_bytes === 'number' ? b.file_size_bytes : null,
    source_subject: typeof b.source_subject === 'string' ? b.source_subject : null,
    source_sender: typeof b.source_sender === 'string' ? b.source_sender : null,
    source_received_at: typeof b.source_received_at === 'string' ? b.source_received_at : null,
    expire_at,
  }
}

/** 公開メタ (r2_key / document_id / recipient_id を落とす)。 */
export function toMetadata(rec: ViewRecord): ViewMetadata {
  return {
    file_name: rec.file_name,
    file_size_bytes: rec.file_size_bytes,
    source_subject: rec.source_subject,
    source_sender: rec.source_sender,
    source_received_at: rec.source_received_at,
    expire_at: rec.expire_at,
  }
}

/** 失効済みなら true。`now` は ms epoch。 */
export function isExpired(expireAtIso: string, nowMs: number): boolean {
  const t = Date.parse(expireAtIso)
  // parse 不能は「失効扱い」に倒す (壊れたレコードを配信し続けない)
  if (Number.isNaN(t)) return true
  return t <= nowMs
}

/**
 * KV put の expirationTtl 秒。expire_at までの残り秒。Cloudflare KV は最小 60s なので
 * それ未満は 60 に切り上げる。既に過去なら 60 (登録直後 expire は事実上無効値)。
 */
export function viewTtlSeconds(expireAtIso: string, nowMs: number): number {
  const t = Date.parse(expireAtIso)
  if (Number.isNaN(t)) return 60
  const secs = Math.floor((t - nowMs) / 1000)
  return secs < 60 ? 60 : secs
}

/**
 * ファイル名から content-type を推測 (rust viewer.rs::guess_content_type と等価)。
 * PDF が多数なので不明拡張子は application/pdf に倒す。
 * 注: 判定は **実 r2_key の拡張子** で行う (redacted は .jpg、原本名は .pdf のまま)。
 */
export function guessContentType(name: string | null | undefined): string {
  const n = (name ?? '').toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.gif')) return 'image/gif'
  if (n.endsWith('.webp')) return 'image/webp'
  // SVG は同一オリジン inline で script 実行 = XSS になり得るので image/svg+xml に
  // しない (octet-stream + attachment に倒す)。txt も inline せず attachment 扱い。
  if (n.endsWith('.svg')) return 'application/octet-stream'
  if (n.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return 'application/pdf'
}

/**
 * 同一オリジンで **inline 配信して安全** な content-type の allowlist。
 * これ以外 (svg / html / octet-stream / text 等) は attachment + octet-stream に倒す
 * (notify オリジンでの XSS 防止)。
 */
export const SAFE_INLINE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export function isSafeInline(contentType: string): boolean {
  return SAFE_INLINE_TYPES.has(contentType)
}

/** `attachment; filename*=UTF-8''...` (inline 不可な型のダウンロード強制用)。 */
export function attachmentDisposition(name: string | null | undefined): string {
  const display = name && name.length > 0 ? name : 'download'
  return `attachment; filename="${display.replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(display)}`
}

/** redacted JPEG (apply_redactions 出力) か。Worker は pdfium を持たないので画像は
 *  これだけ配信し、原本 PDF の rasterize はしない。 */
export function isRedactedJpeg(r2Key: string): boolean {
  const n = r2Key.toLowerCase()
  return n.endsWith('.jpg') || n.endsWith('.jpeg')
}

/**
 * `Content-Disposition: inline; filename="..."; filename*=UTF-8''...` を組み立てる
 * (rust viewer.rs::build_inline_disposition と等価、RFC 5987)。
 */
export function inlineDisposition(name: string | null | undefined): string {
  const display = name && name.length > 0 ? name : 'attachment'
  return `inline; filename="${display.replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(display)}`
}

/** 定数時間比較 (短絡せず全長 XOR 合算、proxy / mcp-introspect と同方式)。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}
