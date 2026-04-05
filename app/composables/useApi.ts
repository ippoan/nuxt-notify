export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const stagingTenantId = config.public.stagingTenantId as string

  async function apiFetch<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (stagingTenantId) {
      headers['X-Tenant-ID'] = stagingTenantId
    }

    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: options.body,
      headers,
    })
  }

  return { apiFetch }
}
