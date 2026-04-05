/**
 * 認証 composable
 * - staging: NUXT_PUBLIC_STAGING_TENANT_ID で X-Tenant-ID バイパス
 * - 本番: auth-worker 経由で Google OAuth → JWT → tenant_id
 *
 * auth-worker redirect: #token=<jwt>&org_id=<uuid>&expires_at=<RFC3339>
 */
import { isClient } from '~/utils/env'

export function useAuth() {
  const config = useRuntimeConfig()
  const authWorkerUrl = config.public.authWorkerUrl as string
  const stagingTenantId = config.public.stagingTenantId as string

  const token = useState<string | null>('auth_token', () => null)
  const tenantId = useState<string | null>('auth_tenant_id', () => null)
  const isAuthenticated = computed(() => !!tenantId.value)

  function init() {
    if (stagingTenantId) {
      tenantId.value = stagingTenantId
      return
    }

    if (isClient) {
      const hash = window.location.hash
      if (hash.includes('token=')) {
        const params = new URLSearchParams(hash.slice(1))
        const t = params.get('token')
        const orgId = params.get('org_id')
        if (t && orgId) {
          token.value = t
          tenantId.value = orgId
          localStorage.setItem('notify_auth', JSON.stringify({ token: t, tenantId: orgId }))
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          return
        }
      }

      try {
        const saved = localStorage.getItem('notify_auth')
        if (saved) {
          const { token: t, tenantId: tid } = JSON.parse(saved)
          token.value = t
          tenantId.value = tid
        }
      } catch {
        // ignore
      }
    }
  }

  function redirectToLogin() {
    if (isClient) {
      const redirectUri = window.location.origin
      window.location.href = `${authWorkerUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`
    }
  }

  function logout() {
    token.value = null
    tenantId.value = null
    if (isClient) {
      localStorage.removeItem('notify_auth')
    }
  }

  return { token, tenantId, isAuthenticated, init, redirectToLogin, logout }
}
