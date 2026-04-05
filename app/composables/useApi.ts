export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const stagingTenantId = config.public.stagingTenantId as string

  async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }

    // staging mode: X-Tenant-ID で認証バイパス
    if (stagingTenantId) {
      headers['X-Tenant-ID'] = stagingTenantId
    }

    const resp = await $fetch<T>(`${apiBase}/api${path}`, {
      ...options,
      headers,
    })
    return resp
  }

  return { apiFetch }
}