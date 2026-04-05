<script setup lang="ts">
const config = useRuntimeConfig()
const { isAuthenticated, tenantId, init, redirectToLogin, logout } = useAuth()
const stagingTenantId = computed(() => config.public.stagingTenantId as string)

onMounted(() => {
  init()
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
          <button v-if="isAuthenticated && !stagingTenantId" @click="logout"
                  class="text-xs text-gray-400 hover:text-red-500">ログアウト</button>
        </div>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6">
      <div v-if="!isAuthenticated" class="text-center py-20">
        <p class="text-gray-500 mb-4">ログインしてください</p>
        <button @click="redirectToLogin"
                class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
          Google でログイン
        </button>
      </div>
      <NuxtPage v-else />
    </main>

    <div v-if="stagingTenantId" class="fixed bottom-0 left-0 right-0 bg-yellow-400 text-center py-1 text-xs font-bold">
      STAGING (tenant: {{ stagingTenantId.slice(0, 8) }}...)
    </div>
  </div>
</template>
