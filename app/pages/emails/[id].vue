<script setup lang="ts">
import { useAuth } from '@ippoan/auth-client'
import { formatSize, formatDate, deliveryStatusLabel } from '~/utils/documentBadges'

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()
const { token } = useAuth()

const messageId = computed(() => String(route.params.id))

interface EmailDocument {
  id: string
  file_name: string | null
  file_size_bytes: number | null
  r2_key: string
  extraction_status: string
  distribution_status: string
  created_at: string
}

interface EmailDetail {
  email_message_id: string
  source_sender: string | null
  source_subject: string | null
  source_body_text: string | null
  source_received_at: string | null
  documents: EmailDocument[]
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
  document: { id: string; file_name?: string | null; distribution_status: string }
  deliveries: Delivery[]
}

const detail = ref<EmailDetail | null>(null)
const deliveriesByDoc = ref<Record<string, Delivery[]>>({})
// viewer Worker が KV に記録した既読 (docId → recipient_id → read_at)。lockdown 移行後の
// 既読は rust DB ではなく KV に入るため rust の read_at とマージ表示する (Refs #434)。
const kvReadsByDoc = ref<Record<string, Record<string, string>>>({})
const loading = ref(true)
const error = ref('')
const deleting = ref<Record<string, boolean>>({})
const distributeTarget = ref<EmailDocument | null>(null)

async function loadDetail() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await apiFetch<EmailDetail>(`/notify/emails/${messageId.value}`)
    await Promise.all(detail.value.documents.map(loadDeliveries))
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function loadDeliveries(doc: EmailDocument) {
  try {
    const res = await apiFetch<DocumentResponse>(`/notify/documents/${doc.id}`)
    deliveriesByDoc.value[doc.id] = res.deliveries
    void loadReadStatus(doc.id)
  } catch {
    deliveriesByDoc.value[doc.id] = []
  }
}

// KV の既読を doc 単位で取得 (best-effort、同一オリジン read-status = requireAuth で tenant scope)。
async function loadReadStatus(docId: string) {
  try {
    const res = await fetch(`/api/notify/read-status/${docId}`)
    if (res.ok) {
      const data = (await res.json()) as { reads: Record<string, string> }
      kvReadsByDoc.value[docId] = data.reads ?? {}
    }
  } catch {
    // ignore
  }
}

// rust DB の read_at と KV の既読をマージ (どちらかにあれば既読)。
function readAtOf(docId: string, d: Delivery): string | null {
  return d.read_at ?? kvReadsByDoc.value[docId]?.[d.recipient_id] ?? null
}

async function downloadDoc(doc: EmailDocument) {
  try {
    // #434 step 2: /api/proxy/* 経由 (introspect で tenant 注入)。
    const headers: Record<string, string> = {}
    if (token.value) headers.Authorization = `Bearer ${token.value}`
    const res = await fetch(`/api/proxy/notify/documents/${doc.id}/download`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.file_name ?? 'attachment'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    alert(`ダウンロード失敗: ${e.message ?? e}`)
  }
}

function openDistribute(doc: EmailDocument) {
  distributeTarget.value = doc
}

async function onDistributed(result: { sent: number; failed: number; total: number }) {
  alert(`配信完了: 成功 ${result.sent} / 失敗 ${result.failed} / 合計 ${result.total}`)
  await loadDetail()
}

async function deleteDoc(doc: EmailDocument) {
  if (!confirm(`「${doc.file_name ?? 'ドキュメント'}」を削除しますか? (R2 + DB から削除)`)) return
  deleting.value[doc.id] = true
  try {
    await apiFetch(`/notify/documents/${doc.id}`, { method: 'DELETE' })
    await loadDetail()
    if (!detail.value || detail.value.documents.length === 0) {
      router.push('/emails')
    }
  } catch (e: any) {
    alert(`削除失敗: ${e.message ?? e}`)
  } finally {
    deleting.value[doc.id] = false
  }
}

onMounted(loadDetail)
</script>

<template>
  <div>
    <div class="mb-4">
      <NuxtLink to="/emails" class="text-sm text-blue-600 hover:underline">← 受信メール一覧</NuxtLink>
    </div>

    <div v-if="loading" class="text-gray-500 py-10 text-center">読み込み中...</div>
    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
      {{ error }}
    </div>
    <div v-else-if="detail">
      <!-- メタデータ -->
      <div class="bg-white border rounded p-4 mb-6">
        <h2 class="text-lg font-bold mb-2">{{ detail.source_subject ?? '(件名なし)' }}</h2>
        <dl class="text-sm grid grid-cols-[6rem_1fr] gap-y-1 text-gray-700">
          <dt class="text-gray-500">送信者:</dt>
          <dd>{{ detail.source_sender ?? '-' }}</dd>
          <dt class="text-gray-500">受信日時:</dt>
          <dd>{{ formatDate(detail.source_received_at) }}</dd>
        </dl>
        <details v-if="detail.source_body_text" class="mt-3">
          <summary class="text-sm text-gray-500 cursor-pointer">本文を表示</summary>
          <pre class="mt-2 bg-gray-50 p-2 rounded text-xs whitespace-pre-wrap max-h-64 overflow-auto">{{ detail.source_body_text }}</pre>
        </details>
      </div>

      <!-- 添付ファイル -->
      <h3 class="text-md font-bold mb-2">添付ファイル ({{ detail.documents.length }})</h3>
      <div v-for="doc in detail.documents" :key="doc.id"
           class="bg-white border rounded p-4 mb-3">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="font-medium">{{ doc.file_name ?? '(無名)' }}</div>
            <div class="text-xs text-gray-500">{{ formatSize(doc.file_size_bytes) }} · 受信 {{ formatDate(doc.created_at) }}</div>
          </div>
          <div class="flex gap-2">
            <button @click="downloadDoc(doc)"
                    class="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded">
              ダウンロード
            </button>
            <button @click="openDistribute(doc)"
                    class="text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1 rounded">
              配信
            </button>
            <button @click="deleteDoc(doc)" :disabled="deleting[doc.id]"
                    class="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1 rounded disabled:opacity-50">
              削除
            </button>
          </div>
        </div>

        <!-- 配信履歴 -->
        <div v-if="deliveriesByDoc[doc.id]?.length" class="mt-3 border-t pt-3">
          <div class="text-xs text-gray-500 mb-2">配信履歴</div>
          <table class="w-full text-xs">
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
              <tr v-for="d in deliveriesByDoc[doc.id]" :key="d.id" class="border-t">
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
                <td class="py-1 text-gray-500">{{ readAtOf(doc.id, d) ? formatDate(readAtOf(doc.id, d)!) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-xs text-gray-400 mt-2">未配信</div>
      </div>
    </div>

    <DistributeModal v-if="distributeTarget"
                     :document-id="distributeTarget.id"
                     :file-name="distributeTarget.file_name"
                     @close="distributeTarget = null"
                     @distributed="onDistributed" />
  </div>
</template>
