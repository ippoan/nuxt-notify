export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string
  const { token, tenantId } = useAuth()

  async function apiFetch<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // JWT があれば Authorization ヘッダー (tenant_id は JWT クレームから取得)
    if (token.value) {
      headers['Authorization'] = `Bearer ${token.value}`
    }

    // JWT がない場合 (staging mode 等) は X-Tenant-ID ヘッダー
    if (!token.value && tenantId.value) {
      headers['X-Tenant-ID'] = tenantId.value
    }

    return await $fetch<T>(`${apiBase}/api${path}`, {
      method: (options.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: options.body,
      headers,
    })
  }

  return { apiFetch }
}
