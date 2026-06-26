import { useAuth } from '@ippoan/auth-client'

// #434 step 2: 認証付き JSON REST 呼び出し (apiFetch) は server route /api/proxy/*
// 経由にする。proxy が auth-worker introspect で JWT を検証し、検証済み identity を
// X-Tenant-ID + X-User-* として rust-alc-api に注入する。client は introspect の
// ため Bearer token (cookie でも可) だけ載せ、X-Tenant-ID は手動付与しない
// (proxy が検証済み tenant を注入するため、client 自称 tenant は不要・無視される)。
//
// path は backend の /api/<path> に対応する。proxy は pathPrefix=/api/ を付けるので
// client は /api/proxy/<path> を叩く (例: /notify/recipients → /api/proxy/notify/recipients)。
//
// uploadFetch (multipart/form-data) は **proxy を通さない** で apiBase 直叩きのまま。
// createIdentityProxyHandler は body を JSON.stringify するため multipart を壊す
// (carins は base64 JSON で送る別契約だが nuxt-notify backend は multipart 前提)。
// multipart の proxy 化は要追加検討 (PR 説明参照)。
export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const { token, orgId } = useAuth()

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (token.value) {
      headers['Authorization'] = `Bearer ${token.value}`
    } else if (orgId.value) {
      headers['X-Tenant-ID'] = orgId.value
    }
    return headers
  }

  async function apiFetch<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    // proxy が introspect 用に token を読む。X-Tenant-ID は手動付与しない。
    if (token.value) headers['Authorization'] = `Bearer ${token.value}`

    return await $fetch<T>(`/api/proxy${path}`, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: options.body,
      headers,
    })
  }

  // multipart/form-data 用。Content-Type は $fetch (ofetch) が
  // boundary 込みで自動設定するので明示しない。
  // proxy 非経由 (上記コメント参照): apiBase 直叩き + 旧 authHeaders 維持。
  async function uploadFetch<T>(path: string, formData: FormData): Promise<T> {
    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: 'POST',
      body: formData,
      headers: authHeaders(),
    })
  }

  return { apiFetch, uploadFetch }
}
