<script setup lang="ts">
import { getHiddenIds, hideDocument, unhideDocument } from '~/utils/hiddenDocuments'
import { bulkMaskConfirmMessage, maskActionLabel } from '~/utils/documentBadges'
import type { LogisticsFields } from '~/utils/documentBadges'
import {
  POLL_INTERVAL_MS,
  inProgressIds,
  keepPolling,
  processingIds,
} from '~/utils/processingPoll'

const { apiFetch } = useApi()
const { onUpdate: onRedactUpdate } = useRedactionWatch()

interface NotifyDocument {
  id: string
  file_name: string | null
  extracted_title: string | null
  extracted_summary: string | null
  // 一覧 API (SELECT *) が返す抽出結果。logistics があれば DocumentCard が
  // 「積込日時 積込県ー降し日時 降し県　輸送品名」タイトルを組み立てる (Refs #68)。
  extracted_data: { logistics?: LogisticsFields | null } | Record<string, unknown> | null
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

const LIST_PATH = '/notify/documents?limit=20'

async function reload() {
  loading.value = true
  error.value = ''
  try {
    documents.value = await apiFetch<NotifyDocument[]>(LIST_PATH)
    // マスクの背景処理が動いている文書は、開いた時点から終わりまで追う
    watchDocuments(processingIds(documents.value))
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

// ── やり直しの後の polling ────────────────────────────────────────────────
// 終わりは WS (onRedactUpdate) でも届くが、WS が来なくても行が切り替わるよう、
// マスクを始めた文書と処理中の文書が終わる (completed / failed / skipped) まで一覧を静かに取り直す。
const watchedIds = ref<Set<string>>(new Set())
let listPollTimer: ReturnType<typeof setTimeout> | null = null
let listPollStartedAt = 0
let listPollFailures = 0

function watchDocuments(ids: Iterable<string>) {
  const next = new Set([...watchedIds.value, ...ids])
  if (next.size === watchedIds.value.size) return
  watchedIds.value = next
  listPollFailures = 0
  listPollStartedAt = Date.now()
  scheduleListPoll()
}

function scheduleListPoll() {
  if (listPollTimer || watchedIds.value.size === 0) return
  listPollTimer = setTimeout(async () => {
    listPollTimer = null
    try {
      // silent reload (loading フラグは触らない、一覧のちらつき防止)
      documents.value = await apiFetch<NotifyDocument[]>(LIST_PATH)
      listPollFailures = 0
    } catch {
      listPollFailures += 1
    }
    watchedIds.value = inProgressIds(documents.value, watchedIds.value)
    if (watchedIds.value.size > 0 && keepPolling(listPollFailures, listPollStartedAt, Date.now())) {
      scheduleListPoll()
    } else {
      watchedIds.value = new Set()
    }
  }, POLL_INTERVAL_MS)
}

onUnmounted(() => {
  if (listPollTimer) {
    clearTimeout(listPollTimer)
    listPollTimer = null
  }
})

// 一括マスクの対象: PDF かつ redaction_status が「未処理」相当
//  - undefined: 状態の列が無い古い行
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

async function recomputeOne(doc: NotifyDocument) {
  if (recomputingIds.value.has(doc.id)) return
  recomputingIds.value = new Set([...recomputingIds.value, doc.id])
  try {
    await apiFetch(`/notify/documents/${doc.id}/redact-recompute`, { method: 'POST' })
    // 即座に状態を processing に倒して UI 反映 (バック側は queue)。終わりまで polling で追う
    doc.redaction_status = 'processing'
    watchDocuments([doc.id])
  } catch (e: any) {
    alert(`マスクの開始に失敗 (${doc.file_name}): ${e.message ?? e}`)
  } finally {
    const next = new Set(recomputingIds.value)
    next.delete(doc.id)
    recomputingIds.value = next
  }
}

async function bulkRecompute() {
  const targets = pendingPdfDocs.value
  if (targets.length === 0) return
  if (!confirm(bulkMaskConfirmMessage(targets.length))) return
  bulkRunning.value = true
  bulkProgress.value = { done: 0, total: targets.length }
  try {
    // バックは queue に積むだけなので同時に POST しても困らないが、
    // rate limit や DB 負荷を抑えるため逐次実行する。
    for (const doc of targets) {
      try {
        await apiFetch(`/notify/documents/${doc.id}/redact-recompute`, { method: 'POST' })
        doc.redaction_status = 'processing'
      } catch (e: any) {
        // 個別失敗は止めずに続行 (後で reload で状態を確認)
        console.error('mask failed', doc.id, e)
      }
      bulkProgress.value = { done: bulkProgress.value.done + 1, total: targets.length }
    }
  } finally {
    bulkRunning.value = false
    // ステータス確認のため直後に最新化し、送った文書を終わりまで polling で追う
    await reload()
    watchDocuments(targets.map((d) => d.id))
    // progress 表示は 3 秒後に消す
    setTimeout(() => { bulkProgress.value = null }, 3000)
  }
}

onMounted(() => {
  hiddenIds.value = getHiddenIds()
  reload()
})

// notify-realtime-bus からの terminal status push を受信したら一覧の該当行を patch。
// (WS が来なくても、やり直しの後は上の polling が終わりまで追う)
onRedactUpdate((ev) => {
  const doc = documents.value.find((d) => d.id === ev.document_id)
  if (!doc) return
  doc.redaction_status = ev.status
  if (typeof ev.redactions_applied === 'number') {
    doc.redactions_applied = ev.redactions_applied
  }
})
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
        <button v-if="pendingPdfDocs.length > 0"
                @click="bulkRecompute"
                :disabled="bulkRunning"
                class="px-3 py-1.5 text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 rounded disabled:opacity-50">
          🔒 未処理 PDF を一括マスク ({{ pendingPdfDocs.length }})
        </button>
        <FolderWatcher @uploaded="reload" />
        <UploadButton @uploaded="reload" />
      </div>
    </div>

    <!-- 一括処理進捗 -->
    <div v-if="bulkProgress"
         class="mb-3 bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
      <div v-if="bulkRunning">
        🔄 マスク開始中… {{ bulkProgress.done }} / {{ bulkProgress.total }}
      </div>
      <div v-else>
        ✅ {{ bulkProgress.total }} 件のマスク開始を送信しました。完了状況は各行を確認してください。
      </div>
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
      <DocumentCard v-for="doc in visibleDocuments" :key="doc.id"
                    :doc="doc"
                    :to="`/documents/${doc.id}`"
                    :dimmed="hiddenIds.has(doc.id)">
        <template #actions>
          <!-- 未処理 PDF は個別にマスク開始ボタンを表示。
               (undefined / pending / failed の PDF が対象) -->
          <button v-if="['pending', 'failed', undefined].includes(doc.redaction_status as any)
                        && (doc.file_name ?? '').toLowerCase().endsWith('.pdf')"
                  @click="recomputeOne(doc)"
                  :disabled="recomputingIds.has(doc.id)"
                  class="text-xs bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 px-3 py-1 rounded disabled:opacity-50">
            {{ recomputingIds.has(doc.id) ? '実行中…' : maskActionLabel(doc.redaction_status) }}
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
        </template>
      </DocumentCard>
    </div>
  </div>
</template>
