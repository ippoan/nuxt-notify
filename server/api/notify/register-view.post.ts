/**
 * POST /api/notify/register-view  (internal、rust が distribute 時に叩く)
 *
 * lockdown 後の公開 viewer を Worker(KV+R2) だけで成立させるため、rust は配信時に
 * token→{r2_key, メタ} を KV に登録する。auth は INTERNAL_SHARED_SECRET の constant-time
 * 比較 (browser JWT は不要 = これは consumer-proof only な internal 経路)。
 *
 * Body: { token, r2_key, document_id, recipient_id, file_name?, file_size_bytes?,
 *         source_subject?, source_sender?, source_received_at?, expire_at }
 */
import type { H3Event } from 'h3'
import {
  parseRegisterBody,
  timingSafeEqual,
  viewKey,
  viewTtlSeconds,
} from '../../utils/notify-view'

function cfEnv(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare as { env?: Record<string, unknown> } | undefined)?.env ?? {}
}

async function resolveSecret(binding: unknown): Promise<string | null> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? null
  }
  return null
}

interface KvPutOptions {
  expirationTtl?: number
}
interface KvNamespace {
  put(key: string, value: string, options?: KvPutOptions): Promise<void>
}

export default defineEventHandler(async (event) => {
  const env = cfEnv(event)

  const expected = await resolveSecret(env.INTERNAL_SHARED_SECRET)
  if (!expected) {
    throw createError({ statusCode: 503, statusMessage: 'INTERNAL_SHARED_SECRET 未設定' })
  }
  const provided = getHeader(event, 'x-notify-internal-secret') ?? ''
  if (!timingSafeEqual(provided, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }

  const kv = env.NOTIFY_VIEW_KV as KvNamespace | undefined
  if (!kv) {
    throw createError({ statusCode: 503, statusMessage: 'NOTIFY_VIEW_KV binding 未設定' })
  }

  const body = await readBody(event)
  const token = body && typeof body === 'object' ? (body as Record<string, unknown>).token : undefined
  if (typeof token !== 'string' || token.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'token 必須' })
  }
  const rec = parseRegisterBody(body)
  if (!rec) {
    throw createError({ statusCode: 400, statusMessage: 'r2_key/document_id/recipient_id/expire_at 必須' })
  }

  await kv.put(viewKey(token), JSON.stringify(rec), {
    expirationTtl: viewTtlSeconds(rec.expire_at, Date.now()),
  })

  return { ok: true }
})
