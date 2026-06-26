import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// Mock @ippoan/auth-client
const mockToken = ref<string | null>(null)
const mockOrgId = ref<string | null>(null)
vi.mock('@ippoan/auth-client', () => ({
  useAuth: () => ({
    token: mockToken,
    orgId: mockOrgId,
  }),
}))

// Mock Nuxt auto-imports
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { apiBase: 'http://localhost:8080' },
}))

const { useApi } = await import('../../app/composables/useApi')

describe('useApi', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockToken.value = null
    mockOrgId.value = null
  })

  // apiFetch は #434 step 2 で /api/proxy/* 経由になった。proxy が introspect で
  // tenant を注入するため、client は X-Tenant-ID を手動付与しない。
  it('GET request with no auth (proxy 経由、X-Tenant-ID なし)', async () => {
    mockFetch.mockResolvedValue([{ id: '1' }])
    const { apiFetch } = useApi()
    const result = await apiFetch('/notify/recipients')

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/recipients', {
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

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/recipients', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('adds Authorization header when JWT token exists (X-Tenant-ID は注入しない)', async () => {
    mockToken.value = 'jwt-test-token'
    mockOrgId.value = 'tenant-123'
    mockFetch.mockResolvedValue([])

    const { apiFetch } = useApi()
    await apiFetch('/notify/documents')

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/documents', {
      method: 'GET',
      body: undefined,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-test-token',
      },
    })
  })

  it('orgId のみでも X-Tenant-ID は付けない (proxy が tenant を注入)', async () => {
    mockToken.value = null
    mockOrgId.value = '11111111-1111-1111-1111-111111111111'
    mockFetch.mockResolvedValue([])

    const { apiFetch } = useApi()
    await apiFetch('/notify/documents')

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/documents', {
      method: 'GET',
      body: undefined,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('DELETE request', async () => {
    mockFetch.mockResolvedValue(undefined)
    const { apiFetch } = useApi()
    await apiFetch('/notify/recipients/abc', { method: 'DELETE' })

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/recipients/abc', {
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

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/notify/recipients/abc', {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  // uploadFetch は multipart のため proxy を通さず apiBase 直叩きのまま (旧挙動維持)。
  describe('uploadFetch (proxy 非経由、apiBase 直叩き)', () => {
    it('POSTs FormData without Content-Type (boundary set by ofetch)', async () => {
      mockFetch.mockResolvedValue({ document_ids: ['id-1'], count: 1 })
      const { uploadFetch } = useApi()
      const fd = new FormData()
      fd.append('file', new File(['x'], 'x.pdf'), 'x.pdf')

      const res = await uploadFetch('/notify/documents/upload', fd)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/notify/documents/upload',
        { method: 'POST', body: fd, headers: {} },
      )
      expect(res).toEqual({ document_ids: ['id-1'], count: 1 })
    })

    it('adds Authorization header for uploadFetch when JWT present', async () => {
      mockToken.value = 'jwt-upload'
      mockFetch.mockResolvedValue({ count: 0 })
      const { uploadFetch } = useApi()
      const fd = new FormData()
      await uploadFetch('/notify/documents/upload', fd)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/notify/documents/upload',
        { method: 'POST', body: fd, headers: { Authorization: 'Bearer jwt-upload' } },
      )
    })

    it('adds X-Tenant-ID header for uploadFetch when no JWT', async () => {
      mockOrgId.value = 'tenant-upload'
      mockFetch.mockResolvedValue({ count: 0 })
      const { uploadFetch } = useApi()
      const fd = new FormData()
      await uploadFetch('/notify/documents/upload', fd)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/notify/documents/upload',
        { method: 'POST', body: fd, headers: { 'X-Tenant-ID': 'tenant-upload' } },
      )
    })
  })
})
