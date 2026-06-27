/**
 * GET /api/notify/read-status/{documentId}  (管理画面用、要認証)
 *
 * viewer Worker が記録した既読 (`read:{tenant_id}:{document_id}:{recipient_id}`) を
 * document 単位で返す。`requireAuth` (auth-worker introspect) で認証し、その `tenant_id`
 * で KV prefix を絞る = **サーバ側でテナント分離** (document_id の秘匿に頼らない)。
 *
 * 返り値: `{ reads: { [recipient_id]: read_at(ISO) } }`
 */
import type { H3Event } from 'h3'
import { requireAuth } from '@ippoan/auth-client/server'
import { readKeyPrefix, type ReadRecord } from '../../../utils/notify-view'

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

interface KvListKey {
  name: string
}
interface KvNamespace {
  get(key: string): Promise<string | null>
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: KvListKey[]
    list_complete: boolean
    cursor?: string
  }>
}

export default defineEventHandler(async (event) => {
  const env = cfEnv(event)
  const kv = env.NOTIFY_VIEW_KV as KvNamespace | undefined
  if (!kv) {
    throw createError({ statusCode: 503, statusMessage: 'NOTIFY_VIEW_KV binding 未設定' })
  }

  // 認証 (introspect)。active なら tenant_id が取れる。inactive は 401 throw。
  const sharedSecret = await resolveSecret(env.INTERNAL_SHARED_SECRET)
  if (!sharedSecret) {
    throw createError({ statusCode: 503, statusMessage: 'INTERNAL_SHARED_SECRET binding 未設定' })
  }
  const cfg = useRuntimeConfig(event)
  const auth = await requireAuth(event, {
    authWorkerUrl: cfg.public.authWorkerUrl as string,
    sharedSecret,
  })

  const documentId = getRouterParam(event, 'documentId') ?? ''
  const prefix = readKeyPrefix(auth.tenant_id, documentId)

  const reads: Record<string, string> = {}
  let cursor: string | undefined
  // prefix list (1000件/ページ)。受信者数は通常少数なので 1〜数ページで完了。
  do {
    const page = await kv.list({ prefix, cursor })
    for (const k of page.keys) {
      const raw = await kv.get(k.name)
      if (raw) {
        const r = JSON.parse(raw) as ReadRecord
        reads[r.recipient_id] = r.read_at
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return { reads }
})
