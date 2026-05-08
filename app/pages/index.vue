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

    <div v-else class="space-y-3">
      <div v-for="doc in documents" :key="doc.id"
           class="bg-white rounded-lg shadow border hover:bg-gray-50 transition">
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

        <!-- 未処理 PDF は個別 redact 開始ボタンを表示。
             (undefined / pending / failed の PDF が対象) -->
        <div v-if="['pending', 'failed', undefined].includes(doc.redaction_status as any)
                   && (doc.file_name ?? '').toLowerCase().endsWith('.pdf')"
             class="px-4 pb-3 -mt-1">
          <button @click="recomputeOne(doc)"
                  :disabled="recomputingIds.has(doc.id)"
                  class="text-xs bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 px-3 py-1 rounded disabled:opacity-50">
            {{ recomputingIds.has(doc.id) ? '実行中…'
               : doc.redaction_status === 'failed' ? '🔄 redact を再試行'
               : '🔄 redact 開始' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
