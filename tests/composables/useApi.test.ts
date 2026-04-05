import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Nuxt auto-imports
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

let mockConfig = {
  public: {
    apiBase: 'http://localhost:8080',
    authWorkerUrl: 'https://auth.example.com',
    stagingTenantId: '',
  },
}
vi.stubGlobal('useRuntimeConfig', () => mockConfig)

// Import after mocks
const { useApi } = await import('../../app/composables/useApi')

describe('useApi', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockConfig = {
      public: {
        apiBase: 'http://localhost:8080',
        authWorkerUrl: 'https://auth.example.com',
        stagingTenantId: '',
      },
    }
  })

  it('GET request with default options', async () => {
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
    const result = await apiFetch('/notify/recipients', { method: 'POST', body })

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/notify/recipients', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(result).toEqual({ id: '2' })
  })

  it('adds X-Tenant-ID header when stagingTenantId is set', async () => {
    mockConfig.public.stagingTenantId = '11111111-1111-1111-1111-111111111111'
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

  it('does not add X-Tenant-ID header when stagingTenantId is empty', async () => {
    mockConfig.public.stagingTenantId = ''
    mockFetch.mockResolvedValue([])

    const { apiFetch } = useApi()
    await apiFetch('/notify/recipients')

    const callHeaders = mockFetch.mock.calls[0][1].headers
    expect(callHeaders).not.toHaveProperty('X-Tenant-ID')
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
