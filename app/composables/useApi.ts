import { useAuth } from '@ippoan/auth-client'

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
      ...authHeaders(),
    }

    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: options.body,
      headers,
    })
  }

  // multipart/form-data 用。Content-Type は $fetch (ofetch) が
  // boundary 込みで自動設定するので明示しない。
  async function uploadFetch<T>(path: string, formData: FormData): Promise<T> {
    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: 'POST',
      body: formData,
      headers: authHeaders(),
    })
  }

  return { apiFetch, uploadFetch }
}
