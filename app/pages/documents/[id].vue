<script setup lang="ts">
import { useAuth } from '@ippoan/auth-client'
import VuePdfEmbed from 'vue-pdf-embed'
import { fetchPdfBytes } from '~/utils/preview-fetch'

const route = useRoute()
const { apiFetch } = useApi()
const { token, orgId } = useAuth()
const { onUpdate: onRedactUpdate } = useRedactionWatch()

const documentId = computed(() => String(route.params.id))

interface LogisticsFields {
  loading_place?: string | null
  unloading_place?: string | null
  loading_at?: string | null
  unloading_at?: string | null
  notes?: string | null
  // 連絡先 3 フィールド (相手先のみ、自社は extract.rs 側で除外済)
  contact_company?: string | null
  contact_person?: string | null
  contact_phone?: string | null
}

interface NotifyDocument {
  id: string
  email_message_id: string | null
  file_name: string | null
  file_size_bytes: number | null
  extracted_title: string | null
  extracted_summary: string | null
  extracted_data: { logistics?: LogisticsFields | null } | Record<string, unknown> | null
  extraction_status: string
  extraction_error: string | null
  distribution_status: string
  // redact パイプライン (migration 109、PR rust-alc-api#314)
  redaction_status: string
  redacted_r2_key: string | null
  redacted_at: string | null
  redactions_applied: number | null
  redaction_error: string | null
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

// プレビュー: redacted (default) / 原本 を切替
const previewMode = ref<'redacted' | 'original'>('redacted')
// VuePdfEmbed (pdfjs-dist) は Uint8Array を直接渡すと Worker に
// `postMessage(transfer)` で buffer が detach される。tab 切替や WS event で
// 並行 loadPreview() が走ると、前 buffer が Worker に届いた瞬間に main thread
// 側の ref が detach 済みになり「ArrayBuffer at index 0 is already detached」
// が発生する。Blob URL 経由にすると、PDF.js が内部で URL から fetch するので
// 各ロードで独立 ArrayBuffer が割り当てられ、main thread 上の参照は無関係になる。
const previewPdfSource = ref<string | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const pdfPages = ref(0)

// 再 redact 実行中フラグ + ポーリング制御
const recomputing = ref(false)
// 物流情報の再抽出フラグ (redact とは別)
const recomputingExtract = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null

// 進行中の preview fetch を中断するための controller。
// 古い response が遅れて到着し新 Blob URL を上書きするのを防ぐ。
let previewAbort: AbortController | null = null
// 直前の Blob URL — 新しい URL に切り替えたら revokeObjectURL して memory を返す。
let previewBlobUrl: string | null = null

function releaseBlobUrl() {
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl)
    previewBlobUrl = null
  }
}

const isPdf = computed(() => {
  const name = document.value?.file_name?.toLowerCase() ?? ''
  return name.endsWith('.pdf')
})

/**
 * 配車手配票から抽出した 8 フィールド
 * (積地・卸地・積み日時・卸し日時・注意事項・連絡先会社名・担当者・電話番号)。
 * バックエンドの `crates/alc-notify/src/extract.rs::LogisticsFields` と対応。
 * `extracted_data.logistics` が object のときのみ取り出す。
 *
 * 連絡先 3 フィールドは「相手先 (依頼元・お客様)」のみ抽出される。自社情報は
 * tenants.name を Gemini プロンプトに渡して除外している。
 */
const logisticsFields = computed<LogisticsFields | null>(() => {
  const d = document.value?.extracted_data
  if (!d || typeof d !== 'object') return null
  const l = (d as { logistics?: LogisticsFields | null }).logistics
  if (!l || typeof l !== 'object') return null
  return l
})

/**
 * 8 フィールドのうち 1 つでも非空なら true。
 * extract が完了して logistics データが揃ったかの UI 表示判定に使う。
 */
const hasLogistics = computed(() => {
  const l = logisticsFields.value
  if (!l) return false
  return [
    l.loading_place,
    l.unloading_place,
    l.loading_at,
    l.unloading_at,
    l.notes,
    l.contact_company,
    l.contact_person,
    l.contact_phone,
  ].some((v) => typeof v === 'string' && v.trim().length > 0)
})

/**
 * extract が「処理中」と見なせる状態。pending = まだ background が触っていない、
 * もしくは ingest 直後のデフォルト値。`completed` で logistics なしも有り得る (PDF 以外
 * や配車手配票でない PDF) ので、status だけで「抽出済み」を判定しない。
 */
const isExtractInProgress = computed(() => {
  const s = document.value?.extraction_status
  return s === 'pending' || s === 'processing'
})

// 配信は redact 完了 / skipped (PDF以外) のみ許可。
// backend (distribute.rs) でも 400 ブロックされるが、UI 側でもボタンを disable する。
// undefined (旧 API) は PDF なら disable、それ以外なら許可 (旧挙動維持)。
const canDistribute = computed(() => {
  const s = document.value?.redaction_status
  if (s === 'completed' || s === 'skipped') return true
  if (!s) return !isPdf.value // status 不明 + PDF は disable で安全側
  return false
})

const distributeDisabledReason = computed(() => {
  if (!document.value) return ''
  switch (document.value.redaction_status) {
    case 'pending':
      return 'マスク処理待ち。完了後に配信できます'
    case 'processing':
      return 'マスク処理中。完了をお待ちください'
    case 'failed':
      return 'マスク失敗。「再 redact」をお試しください'
    default:
      // undefined (旧 API) のとき、PDF だけブロック
      return isPdf.value ? '「🔄 redact 開始」でマスク処理を開始してください' : ''
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await apiFetch<DocumentResponse>(`/notify/documents/${documentId.value}`)
    document.value = res.document
    deliveries.value = res.deliveries
    // processing 中は 5 秒後に再取得 (UI が「処理中」のまま固まらないように)
    schedulePollIfProcessing()
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

function schedulePollIfProcessing() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  // redact 処理中 / extract 処理中 のいずれかなら polling 続行。
  // どちらか先に完走しても、もう片方を見るために残り時間 polling する。
  const redS = document.value?.redaction_status
  const extS = document.value?.extraction_status
  const redactPending = redS === 'processing' || redS === 'pending'
  const extractPending = extS === 'processing' || extS === 'pending'
  if (redactPending || extractPending) {
    pollTimer = setTimeout(() => {
      // silent reload (loading フラグは触らない、UI ちらつき防止)
      apiFetch<DocumentResponse>(`/notify/documents/${documentId.value}`)
        .then((res) => {
          document.value = res.document
          deliveries.value = res.deliveries
          schedulePollIfProcessing()
          // 状態が変わってプレビュー対象が変わるなら再ロード
          if (document.value?.redaction_status === 'completed' && isPdf.value) {
            loadPreview()
          }
        })
        .catch(() => {
          // 失敗してもポーリングは諦める (ユーザーが手動 reload を期待)
        })
    }, 5000)
  }
}

async function loadPreview() {
  if (!document.value || !isPdf.value) return
  // 直前の fetch があれば abort。古い response が遅れて到着して新 URL を
  // 上書きするのを防ぐ。
  previewAbort?.abort()
  const ctrl = new AbortController()
  previewAbort = ctrl
  // 旧 source を即座に外し、旧 Blob URL を解放 (memory leak 防止)。
  // VuePdfEmbed は source=null で内部 PDF document も unload してくれる。
  previewPdfSource.value = null
  releaseBlobUrl()
  previewLoading.value = true
  previewError.value = ''
  pdfPages.value = 0
  try {
    const config = useRuntimeConfig()
    const apiBase = config.public.apiBase as string
    const headers: Record<string, string> = {}
    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`
    } else if (orgId.value) {
      headers['X-Tenant-ID'] = orgId.value
    }
    const qs = previewMode.value === 'original' ? '?original=true' : ''
    // VuePdfEmbed は string URL で fetch すると認証ヘッダを付けられない。
    // 認証付きで bytes を取得 → Blob にして Object URL を作り、source に渡す。
    // pdfjs-dist は URL を内部で fetch するので独立 ArrayBuffer が割り当てられ、
    // main thread 上の他参照とは完全に分離される (= Worker transfer による detach
    // race が構造的に発生しなくなる)。
    const bytes = await fetchPdfBytes(
      `${apiBase}/api/notify/documents/${document.value.id}/preview${qs}`,
      { headers, signal: ctrl.signal },
    )
    if (ctrl.signal.aborted) return
    // TS 5.x で Uint8Array が generic 化され、`Uint8Array<ArrayBufferLike>` は
    // `BlobPart` (= ArrayBufferView<ArrayBuffer>) に直接代入できない。
    // BlobPart にキャストして渡す (実体は同じバイト列)。
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    previewBlobUrl = URL.createObjectURL(blob)
    previewPdfSource.value = previewBlobUrl
  } catch (e: any) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) return
    previewError.value = e.message || String(e)
    previewPdfSource.value = null
    releaseBlobUrl()
  } finally {
    if (previewAbort === ctrl) {
      previewLoading.value = false
      previewAbort = null
    }
  }
}

function onPdfLoaded(doc: { numPages: number }) {
  pdfPages.value = doc?.numPages ?? 0
}

function onPdfError(e: unknown) {
  previewError.value = e instanceof Error ? e.message : String(e)
}

async function recomputeRedaction() {
  if (!document.value || recomputing.value) return
  if (!confirm('redact を再計算します。プレビューが更新されます。よろしいですか?')) return
  recomputing.value = true
  try {
    await apiFetch(`/notify/documents/${document.value.id}/redact-recompute`, { method: 'POST' })
    // 状態を即座に処理中に倒して polling 開始 (バック側は async で processing→completed)
    if (document.value) document.value.redaction_status = 'processing'
    previewPdfSource.value = null
    releaseBlobUrl()
    schedulePollIfProcessing()
  } catch (e: any) {
    alert(`再 redact 失敗: ${e.message ?? e}`)
  } finally {
    recomputing.value = false
  }
}

/**
 * Gemini で `extracted_data.logistics` を再抽出する。
 * バック (`POST /notify/documents/{id}/extract-recompute`) は async で 202 Accepted を返し、
 * ジョブ完走時に extraction_status を completed/failed に書き換える。UI は polling で追う。
 */
async function recomputeExtract() {
  if (!document.value || recomputingExtract.value) return
  recomputingExtract.value = true
  try {
    await apiFetch(`/notify/documents/${document.value.id}/extract-recompute`, { method: 'POST' })
    // 即座に pending に倒して polling 開始 (バック側は async)
    if (document.value) document.value.extraction_status = 'pending'
    schedulePollIfProcessing()
  } catch (e: any) {
    alert(`運送情報の抽出やり直しに失敗: ${e.message ?? e}`)
  } finally {
    recomputingExtract.value = false
  }
}

function switchPreview(mode: 'redacted' | 'original') {
  previewMode.value = mode
  loadPreview()
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

function redactionBadge(): { label: string; cls: string } | null {
  if (!document.value) return null
  switch (document.value.redaction_status) {
    case 'completed':
      return {
        label: document.value.redactions_applied != null
          ? `🔒 マスク済 (${document.value.redactions_applied}箇所)`
          : '🔒 マスク済',
        cls: 'bg-emerald-100 text-emerald-700',
      }
    case 'processing':
      return { label: '🔄 マスク処理中…', cls: 'bg-blue-100 text-blue-700' }
    case 'failed':
      return { label: '⚠️ マスク失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' }
    case 'skipped':
      return { label: 'マスク不要 (PDF以外)', cls: 'bg-gray-100 text-gray-600' }
    default:
      // undefined: PR #314 未デプロイの API レスポンス互換。
      // PDF なら「マスク待ち」、それ以外は非表示。
      return isPdf.value
        ? { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' }
        : null
  }
}

onMounted(async () => {
  await load()
  // PDF なら基本的にプレビューを取得 (preview API 側で COALESCE 動作)。
  // pending / processing / undefined は「準備中」プレースホルダ表示のまま。
  // (undefined = PR #314 未デプロイの API。/preview エンドポイント自体が
  //  存在しないので fetch して 404 にせず、プレースホルダで案内する。)
  if (isPdf.value && document.value) {
    const s = document.value.redaction_status
    if (s === 'completed' || s === 'skipped') {
      loadPreview()
    }
  }
})

// notify-realtime-bus からの terminal status push を受信したら現在のドキュメントを patch。
// polling は引き続き動かす (Phase 3 デプロイ前の旧環境互換 + WS 切断時のフォールバック)。
onRedactUpdate((ev) => {
  if (ev.document_id !== documentId.value) return
  if (!document.value) return
  document.value.redaction_status = ev.status
  if (typeof ev.redactions_applied === 'number') {
    document.value.redactions_applied = ev.redactions_applied
  }
  if (ev.redaction_error) {
    document.value.redaction_error = ev.redaction_error
  }
  // completed になったらプレビューを再ロード
  if (ev.status === 'completed' && isPdf.value && !previewPdfSource.value) {
    loadPreview()
  }
})

onUnmounted(() => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  // 進行中の preview fetch があれば abort。leak した Worker 通信を絶つ。
  previewAbort?.abort()
  previewAbort = null
  // Blob URL も解放 (memory leak 防止)
  releaseBlobUrl()
})
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
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-lg font-bold truncate">📄 {{ document.file_name ?? '(無名)' }}</h2>
              <span v-if="redactionBadge()"
                    :class="['px-2 py-0.5 text-xs rounded-full flex-shrink-0', redactionBadge()!.cls]">
                {{ redactionBadge()!.label }}
              </span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatSize(document.file_size_bytes) }} · 受信 {{ formatDate(document.created_at) }}
              <span v-if="document.redacted_at"> · マスク {{ formatDate(document.redacted_at) }}</span>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="downloadDoc"
                    class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded">
              ダウンロード
            </button>
            <button @click="showDistribute = true"
                    :disabled="!canDistribute"
                    :title="distributeDisabledReason"
                    class="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed">
              配信
            </button>
          </div>
        </div>

        <!-- 配信ブロック理由 (status≠completed/skipped) -->
        <div v-if="!canDistribute && distributeDisabledReason"
             class="mt-3 text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded">
          ℹ️ {{ distributeDisabledReason }}
        </div>

        <!-- redact 失敗時のエラー詳細 + 再 redact ボタン -->
        <div v-if="document.redaction_status === 'failed'"
             class="mt-3 text-xs bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded">
          <div class="font-medium mb-1">マスク処理に失敗しました</div>
          <div v-if="document.redaction_error" class="font-mono break-all">
            {{ document.redaction_error }}
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

        <!-- 運送情報 (配車手配票 PDF から Gemini で抽出した 5 フィールド) -->
        <!-- LINE 配信本文に列挙される。配信前にここで内容確認 + 必要なら抽出やり直し可能 -->
        <div v-if="hasLogistics" class="mt-3 pt-3 border-t">
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-sm font-semibold text-blue-800">📦 運送情報</h4>
            <button @click="recomputeExtract"
                    :disabled="recomputingExtract"
                    class="text-xs text-blue-600 hover:underline disabled:opacity-50">
              {{ recomputingExtract ? '抽出中…' : '抽出やり直し' }}
            </button>
          </div>
          <p class="text-xs text-gray-500 mb-2">
            この情報が LINE 配信時に本文へ載ります
          </p>
          <dl class="grid grid-cols-[7em_1fr] gap-y-1 text-sm">
            <template v-if="logisticsFields?.loading_place">
              <dt class="text-gray-500">📍 積地</dt>
              <dd class="text-gray-900">{{ logisticsFields.loading_place }}</dd>
            </template>
            <template v-if="logisticsFields?.unloading_place">
              <dt class="text-gray-500">📦 卸地</dt>
              <dd class="text-gray-900">{{ logisticsFields.unloading_place }}</dd>
            </template>
            <template v-if="logisticsFields?.loading_at">
              <dt class="text-gray-500">🕐 積込</dt>
              <dd class="text-gray-900">{{ logisticsFields.loading_at }}</dd>
            </template>
            <template v-if="logisticsFields?.unloading_at">
              <dt class="text-gray-500">🕓 卸し</dt>
              <dd class="text-gray-900">{{ logisticsFields.unloading_at }}</dd>
            </template>
            <template v-if="logisticsFields?.notes">
              <dt class="text-gray-500">⚠️ 注意</dt>
              <dd class="text-gray-900 whitespace-pre-wrap">{{ logisticsFields.notes }}</dd>
            </template>
            <!-- 連絡先 3 フィールド (相手先のみ、自社は extract 側で除外済) -->
            <template v-if="logisticsFields?.contact_company">
              <dt class="text-gray-500">🏢 連絡先</dt>
              <dd class="text-gray-900">{{ logisticsFields.contact_company }}</dd>
            </template>
            <template v-if="logisticsFields?.contact_person">
              <dt class="text-gray-500">👤 担当</dt>
              <dd class="text-gray-900">{{ logisticsFields.contact_person }}</dd>
            </template>
            <template v-if="logisticsFields?.contact_phone">
              <dt class="text-gray-500">📞 電話</dt>
              <dd class="text-gray-900">
                <a :href="`tel:${logisticsFields.contact_phone}`"
                   class="text-blue-600 hover:underline">
                  {{ logisticsFields.contact_phone }}
                </a>
              </dd>
            </template>
          </dl>
        </div>

        <!-- extract 処理中: 配車 PDF だが logistics がまだ書かれていない -->
        <div v-else-if="isPdf && isExtractInProgress" class="mt-3 pt-3 border-t">
          <div class="text-sm text-gray-500">
            🔍 運送情報を抽出中…
          </div>
        </div>

        <!-- extract 完了したが logistics なし (配車手配票でなかった、または Gemini が判定外) -->
        <div v-else-if="isPdf && document.extraction_status === 'completed'" class="mt-3 pt-3 border-t">
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">運送情報なし (配車手配票ではないか抽出未対応)</span>
            <button @click="recomputeExtract"
                    :disabled="recomputingExtract"
                    class="text-xs text-blue-600 hover:underline disabled:opacity-50">
              {{ recomputingExtract ? '抽出中…' : '抽出やり直し' }}
            </button>
          </div>
        </div>

        <!-- extract 失敗 -->
        <div v-else-if="document.extraction_status === 'failed'"
             class="mt-3 pt-3 border-t text-xs bg-red-50 border-red-200 text-red-800 px-3 py-2 rounded">
          <div class="flex items-center justify-between">
            <span class="font-medium">運送情報の抽出に失敗しました</span>
            <button @click="recomputeExtract"
                    :disabled="recomputingExtract"
                    class="text-xs underline hover:no-underline">
              {{ recomputingExtract ? '抽出中…' : '再試行' }}
            </button>
          </div>
          <div v-if="document.extraction_error" class="mt-1 font-mono break-all">
            {{ document.extraction_error }}
          </div>
        </div>
      </div>

      <!-- プレビュー (PDF のみ) -->
      <div v-if="isPdf" class="bg-white border rounded p-4 mb-4">
        <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 class="text-sm font-bold">プレビュー</h3>
          <div class="flex items-center gap-2">
            <!-- redacted/原本 切替 (redacted がある時のみ) -->
            <div v-if="document.redacted_r2_key" class="inline-flex rounded border overflow-hidden text-xs">
              <button @click="switchPreview('redacted')"
                      :class="previewMode === 'redacted'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'"
                      class="px-3 py-1">
                マスク済
              </button>
              <button @click="switchPreview('original')"
                      :class="previewMode === 'original'
                        ? 'bg-gray-700 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'"
                      class="px-3 py-1 border-l">
                原本
              </button>
            </div>
            <button v-if="document.redaction_status === 'completed' || document.redaction_status === 'failed'"
                    @click="recomputeRedaction"
                    :disabled="recomputing"
                    class="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1 rounded disabled:opacity-50">
              {{ recomputing ? '実行中…' : '🔄 再 redact' }}
            </button>
            <span v-if="pdfPages > 0" class="text-xs text-gray-400">
              {{ pdfPages }} ページ
            </span>
          </div>
        </div>

        <div v-if="previewLoading" class="text-center py-8 text-sm text-gray-500">
          PDF を読み込み中…
        </div>
        <div v-else-if="previewError"
             class="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          プレビュー失敗: {{ previewError }}
          <button @click="loadPreview" class="ml-2 underline hover:no-underline">再試行</button>
        </div>
        <div v-else-if="document.redaction_status === 'processing'"
             class="text-center py-12">
          <div class="inline-flex items-center gap-2 text-blue-700">
            <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
              <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" class="opacity-75"></path>
            </svg>
            <span class="text-sm font-medium">マスク処理中…</span>
          </div>
          <p class="text-xs text-gray-500 mt-2">完了次第、自動でここに表示されます</p>
        </div>
        <div v-else-if="document.redaction_status === 'pending' || !document.redaction_status"
             class="text-center py-12">
          <div class="text-sm text-gray-700 mb-2">⏳ 準備中</div>
          <p class="text-xs text-gray-500">
            このドキュメントはまだマスク処理されていません。
            <br>
            「🔄 redact 開始」ボタンで処理を開始できます。
          </p>
          <button @click="recomputeRedaction"
                  :disabled="recomputing"
                  class="mt-3 text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 px-4 py-2 rounded disabled:opacity-50">
            {{ recomputing ? '実行中…' : '🔄 redact 開始' }}
          </button>
        </div>
        <ClientOnly v-else-if="previewPdfSource">
          <VuePdfEmbed
            :source="previewPdfSource"
            class="bg-gray-50 rounded border"
            @loaded="onPdfLoaded"
            @loading-failed="onPdfError"
          />
        </ClientOnly>
        <div v-else class="text-center py-8 text-sm text-gray-500">
          プレビューを取得できません。
          <button @click="loadPreview" class="ml-2 underline hover:no-underline">再試行</button>
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

<style scoped>
/* vue-pdf-embed のページレイアウト整形 (v/[token].vue と統一) */
:deep(.vue-pdf-embed__page) {
  margin-bottom: 8px;
}
:deep(.vue-pdf-embed__page canvas) {
  width: 100% !important;
  height: auto !important;
  display: block;
}
</style>
