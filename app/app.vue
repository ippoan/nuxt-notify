<script setup lang="ts">
const config = useRuntimeConfig()

const stagingTenantId = computed(() => config.public.stagingTenantId as string)
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <NuxtLink to="/" class="text-lg font-bold text-gray-800">📨 Notify</NuxtLink>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/" class="text-gray-600 hover:text-blue-600">ダッシュボード</NuxtLink>
          <NuxtLink to="/recipients" class="text-gray-600 hover:text-blue-600">受信者</NuxtLink>
          <NuxtLink to="/test-distribute" class="text-gray-600 hover:text-blue-600">テスト配信</NuxtLink>
        </nav>
      </div>
    </header>
    <main class="max-w-5xl mx-auto px-4 py-6">
      <NuxtPage />
    </main>
    <div v-if="stagingTenantId" class="fixed bottom-0 left-0 right-0 bg-yellow-400 text-center py-1 text-xs font-bold">
      STAGING (tenant: {{ stagingTenantId.slice(0, 8) }}...)
    </div>
  </div>
</template>