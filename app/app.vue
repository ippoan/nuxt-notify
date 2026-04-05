<script setup lang="ts">
import { useAuth } from '@ippoan/auth-client'

const { isAuthenticated, loadFromStorage, consumeFragment, redirectToLogin, logout } = useAuth()
const runtimeConfig = useRuntimeConfig()
const { apiFetch } = useApi()

const lineLoginUrl = computed(() => {
  const apiBase = runtimeConfig.public.apiBase as string
  const redirectUri = encodeURIComponent(window.location.origin + '/?lw_callback=1')
  return `${apiBase}/api/auth/line/redirect?redirect_uri=${redirectUri}`
})

// テナント選択 (LINE Login で複数テナントの場合)
interface TenantOption { id: string; name: string }
const tenantOptions = ref<TenantOption[]>([])
const lineUserId = ref('')
const lineName = ref('')
const selectingTenant = ref(false)

async function selectTenant(tenantId: string) {
  selectingTenant.value = true
  try {
    const res = await apiFetch<{ access_token: string; refresh_token: string; expires_in: number }>(
      '/auth/line/select-tenant',
      {
        method: 'POST',
        body: JSON.stringify({
          line_user_id: lineUserId.value,
          line_name: lineName.value,
          tenant_id: tenantId,
        }),
      },
    )
    // JWT をストレージに保存してリロード
    const hash = `#token=${res.access_token}&refresh_token=${res.refresh_token}&expires_in=${res.expires_in}&lw_callback=1`
    window.location.hash = hash
    consumeFragment()
    loadFromStorage()
    tenantOptions.value = []
  } catch {
    alert('ログインに失敗しました')
  } finally {
    selectingTenant.value = false
  }
}

onMounted(() => {
  consumeFragment()
  loadFromStorage()

  // テナント選択パラメータをチェック
  const params = new URLSearchParams(window.location.search)
  const tenantsParam = params.get('tenants')
  if (tenantsParam) {
    try {
      tenantOptions.value = JSON.parse(tenantsParam)
      lineUserId.value = params.get('line_user_id') || ''
      lineName.value = params.get('line_name') || ''
      // クエリパラメータをクリア
      window.history.replaceState({}, '', window.location.pathname)
    } catch { /* ignore */ }
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <NuxtLink to="/" class="text-lg font-bold text-gray-800">📨 Notify</NuxtLink>
        <div class="flex items-center gap-4">
          <nav v-if="isAuthenticated" class="flex gap-4 text-sm">
            <NuxtLink to="/" class="text-gray-600 hover:text-blue-600">ダッシュボード</NuxtLink>
            <NuxtLink to="/recipients" class="text-gray-600 hover:text-blue-600">受信者</NuxtLink>
            <NuxtLink to="/test-distribute" class="text-gray-600 hover:text-blue-600">テスト配信</NuxtLink>
            <NuxtLink to="/settings" class="text-gray-600 hover:text-blue-600">設定</NuxtLink>
          </nav>
          <button v-if="isAuthenticated" @click="logout"
                  class="text-xs text-gray-400 hover:text-red-500">ログアウト</button>
        </div>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6">
      <!-- テナント選択画面 -->
      <div v-if="tenantOptions.length > 0" class="text-center py-20">
        <p class="text-gray-700 mb-2 font-medium">{{ lineName }} さん</p>
        <p class="text-gray-500 mb-6">ログインするテナントを選択してください</p>
        <div class="flex flex-col items-center gap-3">
          <button v-for="t in tenantOptions" :key="t.id"
                  @click="selectTenant(t.id)"
                  :disabled="selectingTenant"
                  class="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 w-72 text-left disabled:opacity-50">
            {{ t.name }}
          </button>
        </div>
      </div>
      <!-- ログイン画面 -->
      <div v-else-if="!isAuthenticated" class="text-center py-20">
        <p class="text-gray-500 mb-4">ログインしてください</p>
        <div class="flex flex-col items-center gap-3">
          <button @click="redirectToLogin"
                  class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 w-56">
            Google でログイン
          </button>
          <a v-if="lineLoginUrl" :href="lineLoginUrl"
             class="bg-[#06C755] text-white px-6 py-2 rounded hover:bg-[#05a847] w-56 text-center inline-block">
            LINE でログイン
          </a>
        </div>
      </div>
      <NuxtPage v-else />
    </main>
  </div>
</template>
