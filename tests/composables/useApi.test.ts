import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

// Mock Nuxt auto-imports
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)
vi.stubGlobal('computed', computed)

let mockConfig = {
  public: {
    apiBase: 'http://localhost:8080',
    authWorkerUrl: 'https://auth.example.com',
    stagingTenantId: '',
  },
}
vi.stubGlobal('useRuntimeConfig', () => mockConfig)

// Mock useState (Nuxt)
const stateStore: Record<string, any> = {}
vi.stubGlobal('useState', (key: string, init?: () => any) => {
  if (!(key in stateStore)) stateStore[key] = ref(init ? init() : null)
  return stateStore[key]
})

// Stub useAuth as global (Nuxt auto-import)
// Import useAuth module first so we can use it
const authModule = await import('../../app/composables/useAuth')
vi.stubGlobal('useAuth', authModule.useAuth)

const { useApi } = await import('../../app/composables/useApi')

describe('useApi', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    const auth = authModule.useAuth()
    auth.token.value = null
    auth.tenantId.value = null
    mockConfig = {
      public: {
        apiBase: 'http://localhost:8080',
        authWorkerUrl: 'https://auth.example.com',
        stagingTenantId: '',
      },
    }
  })

  it('GET request with no auth', async () => {
    mockFetch.mockResolvedValue([{ id: '1' }])
    const { apiFetch } = useApi()
    const result = await apiFetch('/notify/recipients')

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/recipients', {
      method: 'GET',
      body: undefined,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(result).toEqual([{ id: '1' }])
  })

  it('POST request with body', async () => {
    mockFetch.mockResolvedValue({ id: '2' })
    const { apiFetch } = useApi()
    const body = JSON.stringify({ name: 'Test' })
    await apiFetch('/notify/recipients', { method: 'POST', body })

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/recipients', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('adds Authorization header when JWT token exists', async () => {
    const auth = authModule.useAuth()
    auth.token.value = 'jwt-test-token'
    auth.tenantId.value = 'tenant-123'
    mockFetch.mockResolvedValue([])

    const { apiFetch } = useApi()
    await apiFetch('/notify/documents')

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/documents', {
      method: 'GET',
      body: undefined,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-test-token',
      },
    })
  })

  it('adds X-Tenant-ID when no JWT but tenantId exists', async () => {
    const auth = authModule.useAuth()
    auth.token.value = null
    auth.tenantId.value = '11111111-1111-1111-1111-111111111111'
    mockFetch.mockResolvedValue([])

    const { apiFetch } = useApi()
    await apiFetch('/notify/documents')

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/documents', {
      method: 'GET',
      body: undefined,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': '11111111-1111-1111-1111-111111111111',
      },
    })
  })

  it('DELETE request', async () => {
    mockFetch.mockResolvedValue(undefined)
    const { apiFetch } = useApi()
    await apiFetch('/notify/recipients/abc', { method: 'DELETE' })

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/recipients/abc', {
      method: 'DELETE',
      body: undefined,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('PUT request with body', async () => {
    mockFetch.mockResolvedValue({ enabled: false })
    const { apiFetch } = useApi()
    const body = JSON.stringify({ enabled: false })
    await apiFetch('/notify/recipients/abc', { method: 'PUT', body })

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/recipients/abc', {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  })
})
