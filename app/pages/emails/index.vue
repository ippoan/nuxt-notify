<script setup lang="ts">
const { apiFetch } = useApi()

interface EmailSummary {
  email_message_id: string
  source_sender: string | null
  source_subject: string | null
  source_received_at: string | null
  attachment_count: number
  total_size_bytes: number | null
  distribution_status: 'pending' | 'in_progress' | 'completed' | 'failed'
  created_at: string
}

const emails = ref<EmailSummary[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    emails.value = await apiFetch<EmailSummary[]>('/notify/emails')
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  if (!s) return '-'
  const d = new Date(s)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: '配信済', cls: 'bg-green-100 text-green-700' }
    case 'in_progress':
      return { label: '配信中', cls: 'bg-yellow-100 text-yellow-700' }
    case 'failed':
      return { label: '失敗', cls: 'bg-red-100 text-red-700' }
    default:
      return { label: '未配信', cls: 'bg-gray-100 text-gray-700' }
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">受信メール</h2>
      <button @click="load" class="text-sm text-blue-600 hover:underline">↻ 更新</button>
    </div>

    <div v-if="loading" class="text-gray-500 py-10 text-center">読み込み中...</div>
    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
      {{ error }}
    </div>
    <div v-else-if="emails.length === 0" class="text-gray-500 py-10 text-center">
      受信メールはまだありません。<br>
      <span class="text-xs">ingest 用アドレスは「設定」ページから確認できます。</span>
    </div>
    <table v-else class="min-w-full bg-white border border-gray-200 text-sm">
      <thead class="bg-gray-50 text-left text-xs text-gray-600 uppercase">
        <tr>
          <th class="px-3 py-2">受信日時</th>
          <th class="px-3 py-2">送信者</th>
          <th class="px-3 py-2">件名</th>
          <th class="px-3 py-2 text-right">添付</th>
          <th class="px-3 py-2 text-right">サイズ</th>
          <th class="px-3 py-2">配信状況</th>
        </tr>
      </thead>
      <tbody class="divide-y">
        <tr v-for="m in emails" :key="m.email_message_id"
            class="hover:bg-gray-50 cursor-pointer"
            @click="$router.push(`/emails/${m.email_message_id}`)">
          <td class="px-3 py-2 whitespace-nowrap text-gray-700">
            {{ formatDate(m.source_received_at ?? m.created_at) }}
          </td>
          <td class="px-3 py-2 text-gray-700">{{ m.source_sender ?? '-' }}</td>
          <td class="px-3 py-2 text-gray-900">{{ m.source_subject ?? '(件名なし)' }}</td>
          <td class="px-3 py-2 text-right text-gray-700">{{ m.attachment_count }}</td>
          <td class="px-3 py-2 text-right text-gray-700">{{ formatSize(m.total_size_bytes) }}</td>
          <td class="px-3 py-2">
            <span :class="['inline-block px-2 py-0.5 rounded text-xs', statusBadge(m.distribution_status).cls]">
              {{ statusBadge(m.distribution_status).label }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
