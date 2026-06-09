<script setup lang="ts">
import { getHiddenIds, hideDocument, unhideDocument } from '~/utils/hiddenDocuments'

const { apiFetch } = useApi()
const { onUpdate: onRedactUpdate } = useRedactionWatch()

interface NotifyDocument {
  id: string
  file_name: string | null
  extracted_title: string | null
  extracted_summary: string | null
  source_sender: string | null
  source_subject: string | null
  extraction_status: string
  distribution_status: string
  redaction_status: string
  redactions_applied: number | null
  created_at: string
}

const documents = ref<NotifyDocument[]>([])
const loading = ref(true)
const error = ref('')
const bulkRunning = ref(false)
const bulkProgress = ref<{ done: number; total: number } | null>(null)
// 個別行で実行中の document_id 集合 (二重クリック防止 + ボタン表示)
const recomputingIds = ref<Set<string>>(new Set())
// 削除中の document_id 集合 (二重クリック防止)
const deletingIds = ref<Set<string>>(new Set())
// 非表示 (localStorage, Refs #70 Option A)。非表示も含めて表示するトグル。
const hiddenIds = ref<Set<string>>(new Set())
const showHidden = ref(false)

// showHidden=false のときは非表示 ID を一覧から除外する。
const visibleDocuments = computed(() =>
  showHidden.value
    ? documents.value
    : documents.value.filter((d) => !hiddenIds.value.has(d.id)),
)
// 現在ロード済みドキュメントのうち非表示になっている件数 (トグル表示用)。
const hiddenCount = computed(
  () => documents.value.filter((d) => hiddenIds.value.has(d.id)).length,
)

function toggleHide(doc: NotifyDocument) {
  hiddenIds.value = hiddenIds.value.has(doc.id)
    ? unhideDocument(doc.id)
    : hideDocument(doc.id)
}

async function deleteOne(doc: NotifyDocument) {
  if (deletingIds.value.has(doc.id)) return
  if (!confirm(`「${doc.file_name ?? 'ドキュメント'}」を削除しますか? (R2 + DB から削除)`)) return
  deletingIds.value = new Set([...deletingIds.value, doc.id])
  try {
    await apiFetch(`/notify/documents/${doc.id}`, { method: 'DELETE' })
    // 楽観的更新: 一覧から除去 (full reload 不要)
    documents.value = documents.value.filter((d) => d.id !== doc.id)
    // localStorage 側の非表示エントリも掃除しておく (ゴミ ID を残さない)
    if (hiddenIds.value.has(doc.id)) hiddenIds.value = unhideDocument(doc.id)
  } catch (e: any) {
    alert(`削除失敗: ${e.message ?? e}`)
  } finally {
    const next = new Set(deletingIds.value)
    next.delete(doc.id)
    deletingIds.value = next
  }
}

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

// 一括 redact の対象: PDF かつ redaction_status が「未処理」相当
//  - undefined: API が PR #314 未デプロイ (production 互換)
//  - 'pending': migration 109 default (バックフィルなし)
//  - 'failed':  Gemini 失敗の retry
// processing 中は触らない (重複呼び出し防止)、completed は使い回し。
const pendingPdfDocs = computed(() =>
  documents.value.filter((d) => {
    const s = d.redaction_status
    if (s === 'completed' || s === 'processing' || s === 'skipped') return false
    return (d.file_name ?? '').toLowerCase().endsWith('.pdf')
  }),
)

// API が 404 を返したら「本番未デプロイ」とみなしてフラグを立てる。
// 一度立ったら再度ボタンを叩かないよう全 redact UI を抑制する。
const apiNotDeployed = ref(false)

function isNotDeployedError(e: any): boolean {
  const msg = String(e?.message ?? e)
  // ofetch / $fetch は HTTP エラーを `[POST] "..." 404` で返す
  return msg.includes('404') || e?.statusCode === 404 || e?.status === 404
}

async function recomputeOne(doc: NotifyDocument) {
  if (recomputingIds.value.has(doc.id)) return
  recomputingIds.value = new Set([...recomputingIds.value, doc.id])
  try {
    await apiFetch(`/notify/documents/${doc.id}/redact-recompute`, { method: 'POST' })
    // 即座に状態を processing に倒して UI 反映 (バック側は async)
    doc.redaction_status = 'processing'
  } catch (e: any) {
    if (isNotDeployedError(e)) {
      apiNotDeployed.value = true
    } else {
      alert(`redact 失敗 (${doc.file_name}): ${e.message ?? e}`)
    }
  } finally {
    const next = new Set(recomputingIds.value)
    next.delete(doc.id)
    recomputingIds.value = next
  }
}

async function bulkRecompute() {
  const targets = pendingPdfDocs.value
  if (targets.length === 0) return
  if (!confirm(`未処理 / 失敗の PDF ${targets.length} 件を一括で redact します。よろしいですか?`)) return
  bulkRunning.value = true
  bulkProgress.value = { done: 0, total: targets.length }
  try {
    // バックは tokio::spawn で並列処理するので、同時に POST しても
    // 直列にする必要はない。ただ rate limit や DB 負荷を抑えるため逐次実行する。
    for (const doc of targets) {
      try {
        await apiFetch(`/notify/documents/${doc.id}/redact-recompute`, { method: 'POST' })
        doc.redaction_status = 'processing'
      } catch (e: any) {
        if (isNotDeployedError(e)) {
          apiNotDeployed.value = true
          break // 全件 404 になるはずなのでループ中断
        }
        // 個別失敗は止めずに続行 (後で reload で状態を確認)
        console.error('redact failed', doc.id, e)
      }
      bulkProgress.value = { done: bulkProgress.value.done + 1, total: targets.length }
    }
  } finally {
    bulkRunning.value = false
    if (!apiNotDeployed.value) {
      // ステータス確認のため直後に最新化 (processing → completed の自動遷移を見るために
      // ユーザーが個別ページで polling する前提)
      await reload()
    }
    // progress 表示は 3 秒後に消す
    setTimeout(() => { bulkProgress.value = null }, 3000)
  }
}

onMounted(() => {
  hiddenIds.value = getHiddenIds()
  reload()
})

// notify-realtime-bus からの terminal status push を受信したら一覧の該当行を patch。
// 一覧は polling していないので、これが無いと UI が古いまま (要手動 reload)。
onRedactUpdate((ev) => {
  const doc = documents.value.find((d) => d.id === ev.document_id)
  if (!doc) return
  doc.redaction_status = ev.status
  if (typeof ev.redactions_applied === 'number') {
    doc.redactions_applied = ev.redactions_applied
  }
})

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

// redaction_status: PDF アップロード時に async で金額マスク (migration 109)。
// completed / skipped 以外は配信時に backend で 400 ブロックされる。
// 注: PR #314 が production にデプロイされる前は API が redaction_status を
//     返さない (undefined) → 「マスク待ち」扱いで PDF にだけバッジ表示する。
function redactionBadge(doc: NotifyDocument): { label: string; cls: string } | null {
  const isPdf = (doc.file_name ?? '').toLowerCase().endsWith('.pdf')
  switch (doc.redaction_status) {
    case 'completed':
      return {
        label: doc.redactions_applied != null ? `🔒 ${doc.redactions_applied}箇所` : '🔒 マスク済',
        cls: 'bg-emerald-100 text-emerald-700',
      }
    case 'processing':
      return { label: '🔄 マスク処理中', cls: 'bg-blue-100 text-blue-700' }
    case 'failed':
      return { label: '⚠️ マスク失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return isPdf ? { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' } : null
    case 'skipped':
      // PDF 以外は表示しない (ノイズ削減)
      return null
    default:
      // undefined: PR #314 未デプロイの API レスポンス。
      // PDF だけ「マスク待ち」を出して Phase 3 移行を促す。
      return isPdf ? { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' } : null
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4 gap-2 flex-wrap">
      <h2 class="text-xl font-bold">ドキュメント一覧</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <label v-if="hiddenCount > 0 || showHidden"
               class="flex items-center gap-1 text-sm text-gray-600 select-none cursor-pointer">
          <input v-model="showHidden" type="checkbox" class="rounded">
          非表示も表示 ({{ hiddenCount }})
        </label>
        <button v-if="pendingPdfDocs.length > 0 && !apiNotDeployed"
                @click="bulkRecompute"
                :disabled="bulkRunning"
                class="px-3 py-1.5 text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 rounded disabled:opacity-50">
          🔒 未処理 PDF を一括 redact ({{ pendingPdfDocs.length }})
        </button>
        <FolderWatcher @uploaded="reload" />
        <UploadButton @uploaded="reload" />
      </div>
    </div>

    <!-- 一括処理進捗 -->
    <div v-if="bulkProgress"
         class="mb-3 bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
      <div v-if="bulkRunning">
        🔄 redact 開始中… {{ bulkProgress.done }} / {{ bulkProgress.total }}
      </div>
      <div v-else>
        ✅ {{ bulkProgress.total }} 件の redact 開始を送信しました。完了状況は各行を確認してください。
      </div>
    </div>

    <!-- 本番 API 未デプロイ通知 (PR #314 タグリリース前) -->
    <div v-if="apiNotDeployed"
         class="mb-3 bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-900">
      <div class="font-medium mb-1">⚠️ redact API がまだ本番デプロイされていません</div>
      <p class="text-xs">
        rust-alc-api を <code>/tag-release patch</code> でリリースして
        <code>NOTIFY_REDACT_2STAGE=1</code> を設定すると利用可能になります。
        現状では PDF の金額マスクは無効です。
      </p>
    </div>

    <!-- FolderWatcher の pending list はここに Teleport される -->
    <div id="folder-watcher-pending"></div>

    <div v-if="loading" class="text-gray-500">読み込み中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else-if="documents.length === 0" class="text-gray-400">ドキュメントはまだありません</div>

    <div v-else-if="visibleDocuments.length === 0" class="text-gray-400">
      表示できるドキュメントはありません<span v-if="hiddenCount > 0"> (全て非表示中)</span>
    </div>

    <div v-else class="space-y-3">
      <div v-for="doc in visibleDocuments" :key="doc.id"
           :class="['bg-white rounded-lg shadow border hover:bg-gray-50 transition',
                    hiddenIds.has(doc.id) ? 'opacity-60' : '']">
        <NuxtLink :to="`/documents/${doc.id}`" class="block p-4">
          <div class="flex justify-between items-start gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold truncate">{{ doc.extracted_title || doc.file_name || 'Untitled' }}</h3>
              <p class="text-sm text-gray-500 mt-1 truncate">{{ doc.extracted_summary || doc.source_subject }}</p>
              <p class="text-xs text-gray-400 mt-1">
                {{ doc.source_sender }} · {{ new Date(doc.created_at).toLocaleString('ja-JP') }}
              </p>
            </div>
            <div class="flex gap-2 flex-shrink-0 flex-wrap justify-end">
              <span v-if="redactionBadge(doc)"
                    :class="['px-2 py-0.5 text-xs rounded-full', redactionBadge(doc)!.cls]">
                {{ redactionBadge(doc)!.label }}
              </span>
              <span :class="['px-2 py-0.5 text-xs rounded-full', extractionBadge(doc.extraction_status).cls]">
                {{ extractionBadge(doc.extraction_status).label }}
              </span>
              <span :class="['px-2 py-0.5 text-xs rounded-full', distributionBadge(doc.distribution_status).cls]">
                {{ distributionBadge(doc.distribution_status).label }}
              </span>
            </div>
          </div>
        </NuxtLink>

        <!-- アクション行: 個別 redact (未処理 PDF のみ) + 非表示 + 削除 -->
        <div class="px-4 pb-3 -mt-1 flex items-center gap-2 flex-wrap">
          <!-- 未処理 PDF は個別 redact 開始ボタンを表示。
               (undefined / pending / failed の PDF が対象) -->
          <button v-if="['pending', 'failed', undefined].includes(doc.redaction_status as any)
                        && (doc.file_name ?? '').toLowerCase().endsWith('.pdf')"
                  @click="recomputeOne(doc)"
                  :disabled="recomputingIds.has(doc.id)"
                  class="text-xs bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 px-3 py-1 rounded disabled:opacity-50">
            {{ recomputingIds.has(doc.id) ? '実行中…'
               : doc.redaction_status === 'failed' ? '🔄 redact を再試行'
               : '🔄 redact 開始' }}
          </button>

          <div class="ml-auto flex items-center gap-2">
            <button @click="toggleHide(doc)"
                    class="text-xs text-gray-600 hover:bg-gray-100 border border-gray-200 px-3 py-1 rounded">
              {{ hiddenIds.has(doc.id) ? '👁 再表示' : '🙈 非表示' }}
            </button>
            <button @click="deleteOne(doc)"
                    :disabled="deletingIds.has(doc.id)"
                    class="text-xs text-red-600 hover:bg-red-50 border border-red-200 px-3 py-1 rounded disabled:opacity-50">
              {{ deletingIds.has(doc.id) ? '削除中…' : '🗑 削除' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
