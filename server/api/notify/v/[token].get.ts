/**
 * GET /api/notify/v/{token}  (公開、認証不要)
 *
 * KV `view:{token}` からメタを返す。同時に **既読** を `read:{document_id}:{recipient_id}`
 * に恒久記録する (file キーなので token 失効後も既読履歴は残る)。
 * runtime で rust/auth-worker は呼ばない (Worker + KV のみ)。
 *
 * 失効 410 / 不在 404。応答には r2_key / 内部 id は含めない。content_type は実 r2_key の
 * 拡張子から計算して返す (viewer ページが HEAD せずに PDF/画像を判定できるように)。
 */
import type { H3Event } from 'h3'
import {
  guessContentType,
  isExpired,
  readKey,
  toMetadata,
  viewKey,
  type ReadRecord,
  type ViewRecord,
} from '../../../utils/notify-view'

function cfEnv(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare as { env?: Record<string, unknown> } | undefined)?.env ?? {}
}

interface KvNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export default defineEventHandler(async (event) => {
  const env = cfEnv(event)
  const kv = env.NOTIFY_VIEW_KV as KvNamespace | undefined
  if (!kv) {
    throw createError({ statusCode: 503, statusMessage: 'NOTIFY_VIEW_KV binding 未設定' })
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

  // 既読記録 (恒久、tenant×doc×recipient キー)。初回閲覧時刻を保つため上書きしない。
  const rkey = readKey(rec.tenant_id, rec.document_id, rec.recipient_id)
  const existing = await kv.get(rkey)
  if (!existing) {
    const read: ReadRecord = {
      read_at: new Date().toISOString(),
      recipient_id: rec.recipient_id,
    }
    await kv.put(rkey, JSON.stringify(read))
  }

  return {
    ...toMetadata(rec),
    content_type: guessContentType(rec.r2_key),
  }
})
