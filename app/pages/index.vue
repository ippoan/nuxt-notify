<script setup lang="ts">
const { apiFetch } = useApi()

const documents = ref<any[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    documents.value = await apiFetch('/notify/documents?limit=20')
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">ドキュメント一覧</h2>

    <div v-if="loading" class="text-gray-500">読み込み中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else-if="documents.length === 0" class="text-gray-400">ドキュメントはまだありません</div>

    <div v-else class="space-y-3">
      <div v-for="doc in documents" :key="doc.id"
           class="bg-white rounded-lg shadow p-4 border">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-semibold">{{ doc.extracted_title || doc.file_name || 'Untitled' }}</h3>
            <p class="text-sm text-gray-500 mt-1">{{ doc.extracted_summary || doc.source_subject }}</p>
            <p class="text-xs text-gray-400 mt-1">
              {{ doc.source_sender }} · {{ new Date(doc.created_at).toLocaleString('ja-JP') }}
            </p>
          </div>
          <div class="flex gap-2">
            <span :class="{
              'bg-yellow-100 text-yellow-700': doc.extraction_status === 'pending',
              'bg-green-100 text-green-700': doc.extraction_status === 'completed',
              'bg-red-100 text-red-700': doc.extraction_status === 'failed',
            }" class="px-2 py-0.5 text-xs rounded-full">
              {{ doc.extraction_status }}
            </span>
            <span :class="{
              'bg-gray-100 text-gray-600': doc.distribution_status === 'pending',
              'bg-blue-100 text-blue-700': doc.distribution_status === 'in_progress',
              'bg-green-100 text-green-700': doc.distribution_status === 'completed',
            }" class="px-2 py-0.5 text-xs rounded-full">
              {{ doc.distribution_status }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>