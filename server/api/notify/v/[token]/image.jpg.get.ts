/**
 * GET /api/notify/v/{token}/image.jpg  (公開、認証不要)
 *
 * LINE / LINE WORKS の image message `originalContentUrl` 用 (拡張子で画像判定される)。
 * Worker は pdfium を持たないので **redacted 済みの .jpg のみ** R2 から配信し、
 * 原本 PDF の rasterize はしない (= 非 redacted は画像送信しない方針、Refs #434)。
 * redacted でない (= r2_key が .jpg でない) 場合は 415。
 */
import type { H3Event } from 'h3'
import { isExpired, isRedactedJpeg, viewKey, type ViewRecord } from '../../../../utils/notify-view'

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

  // 非 redacted (原本 PDF 等) は Worker で rasterize できないため画像配信しない
  if (!isRedactedJpeg(rec.r2_key)) {
    throw createError({ statusCode: 415, statusMessage: 'no redacted image' })
  }

  const obj = await r2.get(rec.r2_key)
  if (!obj) {
    throw createError({ statusCode: 404, statusMessage: 'object not found' })
  }
  const bytes = new Uint8Array(await obj.arrayBuffer())
  setResponseHeader(event, 'content-type', 'image/jpeg')
  setResponseHeader(event, 'content-disposition', 'inline')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  return bytes
})
