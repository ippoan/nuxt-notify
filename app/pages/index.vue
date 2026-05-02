<script setup lang="ts">
const { apiFetch } = useApi()

interface NotifyDocument {
  id: string
  file_name: string | null
  extracted_title: string | null
  extracted_summary: string | null
  source_sender: string | null
  source_subject: string | null
  extraction_status: string
  distribution_status: string
  created_at: string
}

const documents = ref<NotifyDocument[]>([])
const loading = ref(true)
const error = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  try {
    documents.value = await apiFetch<NotifyDocument[]>('/notify/documents?limit=20')
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

onMounted(reload)

function extractionBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: '抽出済', cls: 'bg-green-100 text-green-700' }
    case 'failed':
      return { label: '抽出失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: '抽出待ち', cls: 'bg-yellow-100 text-yellow-700' }
    default:
      return { label: status, cls: 'bg-gray-100 text-gray-600' }
  }
}

function distributionBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: '配信済', cls: 'bg-green-100 text-green-700' }
    case 'in_progress':
      return { label: '配信中', cls: 'bg-blue-100 text-blue-700' }
    case 'failed':
      return { label: '配信失敗', cls: 'bg-red-100 text-red-700' }
    default:
      return { label: '未配信', cls: 'bg-gray-100 text-gray-600' }
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold">ドキュメント一覧</h2>
      <UploadButton @uploaded="reload" />
    </div>

    <div v-if="loading" class="text-gray-500">読み込み中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else-if="documents.length === 0" class="text-gray-400">ドキュメントはまだありません</div>

    <div v-else class="space-y-3">
      <NuxtLink v-for="doc in documents" :key="doc.id"
                :to="`/documents/${doc.id}`"
                class="block bg-white rounded-lg shadow p-4 border hover:bg-gray-50 transition">
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold truncate">{{ doc.extracted_title || doc.file_name || 'Untitled' }}</h3>
            <p class="text-sm text-gray-500 mt-1 truncate">{{ doc.extracted_summary || doc.source_subject }}</p>
            <p class="text-xs text-gray-400 mt-1">
              {{ doc.source_sender }} · {{ new Date(doc.created_at).toLocaleString('ja-JP') }}
            </p>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <span :class="['px-2 py-0.5 text-xs rounded-full', extractionBadge(doc.extraction_status).cls]">
              {{ extractionBadge(doc.extraction_status).label }}
            </span>
            <span :class="['px-2 py-0.5 text-xs rounded-full', distributionBadge(doc.distribution_status).cls]">
              {{ distributionBadge(doc.distribution_status).label }}
            </span>
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
