import { useAuth } from '@ippoan/auth-client'

export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const { token, orgId } = useAuth()

  async function apiFetch<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (token.value) {
      headers['Authorization'] = `Bearer ${token.value}`
    } else if (orgId.value) {
      headers['X-Tenant-ID'] = orgId.value
    }

    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: options.body,
      headers,
    })
  }

  return { apiFetch }
}
