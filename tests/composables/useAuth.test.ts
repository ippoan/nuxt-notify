/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'

// Mock env (isClient)
const envMock = vi.hoisted(() => ({ isClient: true }))
vi.mock('~/utils/env', () => envMock)

// Mock Nuxt auto-imports
vi.stubGlobal('computed', computed)

let mockConfig = {
  public: {
    apiBase: 'http://localhost:8080',
    authWorkerUrl: 'https://auth.example.com',
    stagingTenantId: '',
  },
}
vi.stubGlobal('useRuntimeConfig', () => mockConfig)

const stateStore: Record<string, any> = {}
vi.stubGlobal('useState', (key: string, init?: () => any) => {
  if (!(key in stateStore)) stateStore[key] = ref(init ? init() : null)
  return stateStore[key]
})

describe('useAuth', () => {
  beforeEach(() => {
    Object.keys(stateStore).forEach((k) => delete stateStore[k])
    mockConfig = {
      public: {
        apiBase: 'http://localhost:8080',
        authWorkerUrl: 'https://auth.example.com',
        stagingTenantId: '',
      },
    }
    envMock.isClient = true
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('init with stagingTenantId sets tenantId directly', async () => {
    mockConfig.public.stagingTenantId = 'staging-tenant-123'
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, tenantId, isAuthenticated } = useAuth()
    init()
    expect(tenantId.value).toBe('staging-tenant-123')
    expect(isAuthenticated.value).toBe(true)
  })

  it('init consumes URL fragment', async () => {
    window.history.replaceState(null, '', '/#token=jwt123&org_id=org-456')
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token, tenantId } = useAuth()
    init()
    expect(token.value).toBe('jwt123')
    expect(tenantId.value).toBe('org-456')
    expect(window.location.hash).toBe('')
    const saved = JSON.parse(localStorage.getItem('notify_auth')!)
    expect(saved.token).toBe('jwt123')
  })

  it('init restores from localStorage', async () => {
    localStorage.setItem('notify_auth', JSON.stringify({ token: 'saved-jwt', tenantId: 'saved-tid' }))
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token, tenantId } = useAuth()
    init()
    expect(token.value).toBe('saved-jwt')
    expect(tenantId.value).toBe('saved-tid')
  })

  it('init handles invalid localStorage gracefully', async () => {
    localStorage.setItem('notify_auth', 'not-json')
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token } = useAuth()
    init()
    expect(token.value).toBeNull()
  })

  it('init does nothing when no fragment and no localStorage', async () => {
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, isAuthenticated } = useAuth()
    init()
    expect(isAuthenticated.value).toBe(false)
  })

  it('init skips browser logic when isClient is false', async () => {
    envMock.isClient = false
    localStorage.setItem('notify_auth', JSON.stringify({ token: 'x', tenantId: 'y' }))
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token } = useAuth()
    init()
    // isClient=false なので localStorage は読まない
    expect(token.value).toBeNull()
  })

  it('redirectToLogin navigates to auth-worker', async () => {
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const hrefSpy = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
    const { redirectToLogin } = useAuth()
    redirectToLogin()
    expect(hrefSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://auth.example.com/login?redirect_uri='),
    )
    hrefSpy.mockRestore()
  })

  it('redirectToLogin does nothing when isClient is false', async () => {
    envMock.isClient = false
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const hrefSpy = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
    const { redirectToLogin } = useAuth()
    redirectToLogin()
    expect(hrefSpy).not.toHaveBeenCalled()
    hrefSpy.mockRestore()
  })

  it('logout clears state and localStorage', async () => {
    localStorage.setItem('notify_auth', JSON.stringify({ token: 'x', tenantId: 'y' }))
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const auth = useAuth()
    auth.init()
    expect(auth.token.value).toBe('x')

    auth.logout()
    expect(auth.token.value).toBeNull()
    expect(auth.tenantId.value).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
    expect(localStorage.getItem('notify_auth')).toBeNull()
  })

  it('logout skips localStorage when isClient is false', async () => {
    envMock.isClient = true
    localStorage.setItem('notify_auth', JSON.stringify({ token: 'x', tenantId: 'y' }))
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const auth = useAuth()
    auth.init()
    expect(auth.token.value).toBe('x')
    // Now switch to server mode and logout
    envMock.isClient = false
    vi.resetModules()
    const { useAuth: useAuth2 } = await import('../../app/composables/useAuth')
    const auth2 = useAuth2()
    auth2.logout()
    expect(auth2.token.value).toBeNull()
    // localStorage still has the old value (not cleared in server mode)
    expect(localStorage.getItem('notify_auth')).not.toBeNull()
  })

  it('fragment with token but no org_id is ignored', async () => {
    window.history.replaceState(null, '', '/#token=jwt-only')
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token } = useAuth()
    init()
    // token= exists but org_id is missing, so should fall through to localStorage
    expect(token.value).toBeNull()
  })

  it('fragment without token key is ignored', async () => {
    window.history.replaceState(null, '', '/#other=value')
    vi.resetModules()
    const { useAuth } = await import('../../app/composables/useAuth')
    const { init, token } = useAuth()
    init()
    expect(token.value).toBeNull()
  })
})
