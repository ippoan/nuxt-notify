/**
 * GET /api/notify/v/{token}/file  (公開、認証不要)
 *
 * KV `view:{token}` → r2_key を引き、R2 binding から bytes を **同一オリジン配信** する
 * (PDF.js が CORS で R2 直 fetch 不可のため)。Content-Type は実 r2_key の拡張子で決める
 * (redacted は .jpg、原本名 file_name は .pdf のままなので r2_key で判定)。
 */
import type { H3Event } from 'h3'
import {
  attachmentDisposition,
  guessContentType,
  inlineDisposition,
  isExpired,
  isSafeInline,
  viewKey,
  type ViewRecord,
} from '../../../../utils/notify-view'

function cfEnv(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare as { env?: Record<string, unknown> } | undefined)?.env ?? {}
}

interface KvNamespace {
  get(key: string): Promise<string | null>
}
interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>
}

export default defineEventHandler(async (event) => {
  const env = cfEnv(event)
  const kv = env.NOTIFY_VIEW_KV as KvNamespace | undefined
  const r2 = env.NOTIFY_R2 as R2Bucket | undefined
  if (!kv || !r2) {
    throw createError({ statusCode: 503, statusMessage: 'NOTIFY_VIEW_KV/NOTIFY_R2 binding 未設定' })
  }

  const token = getRouterParam(event, 'token') ?? ''
  const raw = await kv.get(viewKey(token))
  if (!raw) {
    throw createError({ statusCode: 404, statusMessage: 'not found' })
  }
  const rec = JSON.parse(raw) as ViewRecord
  if (isExpired(rec.expire_at, Date.now())) {
    throw createError({ statusCode: 410, statusMessage: 'gone' })
  }

  const obj = await r2.get(rec.r2_key)
  if (!obj) {
    throw createError({ statusCode: 404, statusMessage: 'object not found' })
  }
  const bytes = new Uint8Array(await obj.arrayBuffer())

  // Content-Type は実 r2_key で判定 (redacted .jpg / 原本 .pdf)。ただし **同一オリジン
  // inline は XSS リスク**なので allowlist (pdf/png/jpeg/gif/webp) 外は octet-stream +
  // attachment に倒し、さらに nosniff + CSP sandbox で defense-in-depth する。
  const ct = guessContentType(rec.r2_key)
  const safe = isSafeInline(ct)
  setResponseHeader(event, 'content-type', safe ? ct : 'application/octet-stream')
  setResponseHeader(
    event,
    'content-disposition',
    safe ? inlineDisposition(rec.file_name) : attachmentDisposition(rec.file_name),
  )
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  return bytes
})
