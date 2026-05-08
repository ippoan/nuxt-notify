<script setup lang="ts">
// 配信受信者向けの公開 viewer ページ。ログイン不要。
// /api/notify/read/{token} 経由で 302 redirect されてくる。
//
// PDF は vue-pdf-embed (PDF.js) で <canvas> に描画する。
// LINE / LINE WORKS の内蔵 webview は PDF をネイティブ表示できないので、
// canvas に描画するしか確実な inline 表示の方法がない。
import VuePdfEmbed from 'vue-pdf-embed'

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string

const token = computed(() => String(route.params.token))
const fileUrl = computed(() => `${apiBase}/api/notify/v/${token.value}/file`)

interface ViewMetadata {
  file_name: string | null
  file_size_bytes: number | null
  source_subject: string | null
  source_sender: string | null
  source_received_at: string | null
  expire_at: string
}

const meta = ref<ViewMetadata | null>(null)
const status = ref<'loading' | 'ok' | 'gone' | 'not_found' | 'error'>('loading')
const pdfLoaded = ref(false)
const pdfPages = ref(0)
const pdfError = ref('')

// 実体の content-type (HEAD で取得)。原本ファイル名は `.pdf` でも redacted の
// 実ファイルが `.jpg` (rust-alc-api PR #327 以降) のケースに対応するため、
// ファイル名ではなくレスポンスヘッダで判断する。
const fileContentType = ref<string | null>(null)

const isPdf = computed(() => {
  const ct = fileContentType.value ?? ''
  return ct.startsWith('application/pdf')
})
const isImage = computed(() => {
  const ct = fileContentType.value ?? ''
  return ct.startsWith('image/')
})

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  if (!s) return ''
  return new Date(s).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

async function load() {
  try {
    const res = await fetch(`${apiBase}/api/notify/v/${token.value}`)
    if (res.status === 410) { status.value = 'gone'; return }
    if (res.status === 404) { status.value = 'not_found'; return }
    if (!res.ok) { status.value = 'error'; return }
    meta.value = await res.json()
    // 並行で実体の Content-Type を HEAD で取る (PDF / JPEG 切替判定)。
    // HEAD が失敗したり Content-Type が不明だったら fileContentType=null のまま
    // → 「ファイルを開く」ボタン (default ブランチ) に倒す。
    try {
      const head = await fetch(fileUrl.value, { method: 'HEAD' })
      if (head.ok) {
        fileContentType.value = head.headers.get('content-type')?.toLowerCase() ?? null
      }
    } catch {
      // ignore — fallback to file-name based detection はしない (古い情報の方が有害)
    }
    status.value = 'ok'
  } catch {
    status.value = 'error'
  }
}

function onPdfLoaded(doc: { numPages: number }) {
  pdfPages.value = doc?.numPages ?? 0
  pdfLoaded.value = true
}

function onPdfError(e: unknown) {
  pdfError.value = e instanceof Error ? e.message : String(e)
}

onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- 上部バー -->
    <header class="bg-white shadow-sm border-b sticky top-0 z-10">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-base sm:text-lg font-bold text-gray-800 truncate">
            {{ meta?.file_name ?? '添付ファイル' }}
          </div>
          <div v-if="meta" class="text-xs text-gray-500 truncate">
            <span v-if="meta.source_subject">{{ meta.source_subject }}</span>
            <span v-if="meta.source_sender"> · {{ meta.source_sender }}</span>
            <span v-if="meta.source_received_at"> · {{ formatDate(meta.source_received_at) }}</span>
            <span v-if="meta.file_size_bytes"> · {{ formatSize(meta.file_size_bytes) }}</span>
            <span v-if="isPdf && pdfPages"> · {{ pdfPages }}ページ</span>
          </div>
        </div>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-2 sm:px-4 py-3">
      <div v-if="status === 'loading'" class="text-center py-20 text-gray-500">
        読み込み中…
      </div>
      <div v-else-if="status === 'gone'" class="text-center py-20">
        <div class="text-2xl mb-2">⏰</div>
        <p class="text-gray-700">このリンクの有効期限が切れています。</p>
        <p class="text-sm text-gray-500 mt-2">送信元にお問い合わせください。</p>
      </div>
      <div v-else-if="status === 'not_found'" class="text-center py-20">
        <p class="text-gray-700">リンクが見つかりません。</p>
      </div>
      <div v-else-if="status === 'error'" class="text-center py-20">
        <p class="text-gray-700">読み込みに失敗しました。</p>
        <button @click="load" class="mt-3 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm">
          再試行
        </button>
      </div>
      <div v-else-if="isPdf">
        <!-- PDF.js (canvas 描画): モバイル webview 含む全環境で確実に inline 表示 -->
        <ClientOnly>
          <div v-if="!pdfLoaded && !pdfError" class="text-center py-12 text-gray-500 text-sm">
            PDF を読み込み中…
          </div>
          <div v-if="pdfError" class="text-center py-12">
            <p class="text-red-700 text-sm">PDF の読み込みに失敗しました</p>
            <p class="text-xs text-gray-500 mt-1">{{ pdfError }}</p>
          </div>
          <VuePdfEmbed
            :source="fileUrl"
            class="bg-white shadow-sm rounded"
            @loaded="onPdfLoaded"
            @loading-failed="onPdfError"
          />
        </ClientOnly>
      </div>
      <div v-else-if="isImage" class="text-center">
        <img :src="fileUrl" :alt="meta?.file_name ?? ''" class="max-w-full mx-auto rounded shadow-sm" />
      </div>
      <div v-else class="text-center py-20">
        <a :href="fileUrl" target="_blank" rel="noopener"
           class="inline-block bg-blue-600 text-white text-lg font-medium px-8 py-4 rounded-lg hover:bg-blue-700">
          📥 ファイルを開く
        </a>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* vue-pdf-embed のページを横に余白を持たせて並べる (見やすさ) */
:deep(.vue-pdf-embed__page) {
  margin-bottom: 12px;
}
:deep(.vue-pdf-embed__page canvas) {
  width: 100% !important;
  height: auto !important;
  display: block;
}
</style>
