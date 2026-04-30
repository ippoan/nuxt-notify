<script setup lang="ts">
import { useAuth } from '@ippoan/auth-client'

const route = useRoute()
const { apiFetch } = useApi()
const { token, orgId } = useAuth()

const documentId = computed(() => String(route.params.id))

interface NotifyDocument {
  id: string
  email_message_id: string | null
  file_name: string | null
  file_size_bytes: number | null
  extracted_title: string | null
  extracted_summary: string | null
  extraction_status: string
  distribution_status: string
  created_at: string
}

interface Delivery {
  id: string
  recipient_id: string
  recipient_name: string
  provider: string
  status: string
  sent_at: string | null
  read_at: string | null
  triggered_by_user_id: string | null
  triggered_by_name: string | null
  triggered_by_email: string | null
  created_at: string
}

interface DocumentResponse {
  document: NotifyDocument
  deliveries: Delivery[]
}

const document = ref<NotifyDocument | null>(null)
const deliveries = ref<Delivery[]>([])
const loading = ref(true)
const error = ref('')
const showDistribute = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await apiFetch<DocumentResponse>(`/notify/documents/${documentId.value}`)
    document.value = res.document
    deliveries.value = res.deliveries
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function downloadDoc() {
  if (!document.value) return
  try {
    const config = useRuntimeConfig()
    const apiBase = config.public.apiBase as string
    const headers: Record<string, string> = {}
    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`
    } else if (orgId.value) {
      headers['X-Tenant-ID'] = orgId.value
    }
    const res = await fetch(`${apiBase}/api/notify/documents/${document.value.id}/download`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = document.value.file_name ?? 'attachment'
    window.document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    alert(`ダウンロード失敗: ${e.message ?? e}`)
  }
}

async function onDistributed(result: { sent: number; failed: number; total: number }) {
  alert(`配信完了: 成功 ${result.sent} / 失敗 ${result.failed} / 合計 ${result.total}`)
  await load()
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  if (!s) return '-'
  return new Date(s).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deliveryStatusLabel(status: string): { label: string; cls: string } {
  switch (status) {
    case 'sent':
      return { label: '送信済', cls: 'bg-green-100 text-green-700' }
    case 'failed':
      return { label: '失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: '未送信', cls: 'bg-gray-100 text-gray-700' }
    default:
      return { label: status, cls: 'bg-gray-100 text-gray-700' }
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="mb-4">
      <NuxtLink v-if="document?.email_message_id"
                :to="`/emails/${document.email_message_id}`"
                class="text-sm text-blue-600 hover:underline">
        ← メール詳細へ
      </NuxtLink>
      <NuxtLink v-else to="/emails" class="text-sm text-blue-600 hover:underline">
        ← 受信メール一覧
      </NuxtLink>
    </div>

    <div v-if="loading" class="text-gray-500 py-10 text-center">読み込み中...</div>
    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
      {{ error }}
    </div>
    <div v-else-if="document">
      <!-- ヘッダ -->
      <div class="bg-white border rounded p-4 mb-4">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-bold truncate">📄 {{ document.file_name ?? '(無名)' }}</h2>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatSize(document.file_size_bytes) }} · 受信 {{ formatDate(document.created_at) }}
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="downloadDoc"
                    class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded">
              ダウンロード
            </button>
            <button @click="showDistribute = true"
                    class="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded">
              配信
            </button>
          </div>
        </div>

        <div v-if="document.extracted_title || document.extracted_summary"
             class="mt-3 pt-3 border-t text-sm text-gray-700">
          <div v-if="document.extracted_title" class="font-medium">
            {{ document.extracted_title }}
          </div>
          <div v-if="document.extracted_summary" class="mt-1 text-gray-600 whitespace-pre-wrap">
            {{ document.extracted_summary }}
          </div>
        </div>
      </div>

      <!-- 配信履歴 -->
      <div class="bg-white border rounded p-4">
        <h3 class="text-sm font-bold mb-3">配信履歴</h3>
        <div v-if="deliveries.length === 0" class="text-sm text-gray-400">未配信</div>
        <table v-else class="w-full text-xs">
          <thead class="text-gray-500">
            <tr>
              <th class="text-left py-1">送信日時</th>
              <th class="text-left py-1">実行者</th>
              <th class="text-left py-1">受信者</th>
              <th class="text-left py-1">手段</th>
              <th class="text-left py-1">状況</th>
              <th class="text-left py-1">既読</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in deliveries" :key="d.id" class="border-t">
              <td class="py-1 text-gray-700">{{ formatDate(d.sent_at ?? d.created_at) }}</td>
              <td class="py-1 text-gray-700">
                {{ d.triggered_by_name || d.triggered_by_email || '-' }}
              </td>
              <td class="py-1 text-gray-900">{{ d.recipient_name }}</td>
              <td class="py-1 text-gray-500">{{ d.provider }}</td>
              <td class="py-1">
                <span :class="['inline-block px-1.5 py-0.5 rounded', deliveryStatusLabel(d.status).cls]">
                  {{ deliveryStatusLabel(d.status).label }}
                </span>
              </td>
              <td class="py-1 text-gray-500">{{ d.read_at ? formatDate(d.read_at) : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DistributeModal v-if="showDistribute && document"
                     :document-id="document.id"
                     :file-name="document.file_name"
                     @close="showDistribute = false"
                     @distributed="onDistributed" />
  </div>
</template>
