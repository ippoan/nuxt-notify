<script setup lang="ts">
// 配信受信者向けの公開 viewer ページ。ログイン不要。
// /api/notify/read/{token} 経由で 302 redirect されてくる。
//
// ページ内で
//   GET /api/notify/v/{token}      → メタデータ JSON
//   <iframe src="...v/{token}/file"> → R2 inline PDF
// を呼ぶ。

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string

const token = computed(() => String(route.params.token))
const fileUrl = computed(() => `${apiBase}/api/notify/v/${token.value}/file`)
// iframe 用: Chrome PDF ビューアの toolbar / nav pane を隠してすっきり見せる。
// (新タブで開くボタンは fileUrl のまま — toolbar 経由で download / print したい)
const iframeUrl = computed(() => `${fileUrl.value}#toolbar=0&navpanes=0`)

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

const isPdf = computed(() => {
  const name = meta.value?.file_name ?? ''
  return name.toLowerCase().endsWith('.pdf')
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
    status.value = 'ok'
  } catch {
    status.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-gray-50">
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
          </div>
        </div>
        <a v-if="status === 'ok'" :href="fileUrl" target="_blank" rel="noopener"
           class="shrink-0 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-blue-700 whitespace-nowrap">
          📄 開く
        </a>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-4">
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
      <div v-else>
        <!-- モバイル (Android Chrome は iframe で PDF を render せず DL する): 大きい「開く」ボタンのみ -->
        <div class="md:hidden text-center py-12">
          <a :href="fileUrl" target="_blank" rel="noopener"
             class="inline-block bg-blue-600 text-white text-xl font-bold px-10 py-5 rounded-2xl hover:bg-blue-700 shadow-lg active:scale-95 transition">
            📄 {{ isPdf ? 'PDF を開く' : 'ファイルを開く' }}
          </a>
          <p class="mt-4 text-sm text-gray-500">タップすると別タブで開きます</p>
        </div>
        <!-- デスクトップ (md+): iframe で inline 表示 -->
        <div class="hidden md:block">
          <iframe v-if="isPdf" :src="iframeUrl" class="w-full h-[80vh] bg-white border rounded shadow-sm"
                  title="PDF ビューア"></iframe>
          <div v-else class="text-center py-20">
            <a :href="fileUrl" target="_blank" rel="noopener"
               class="inline-block bg-blue-600 text-white text-lg font-medium px-8 py-4 rounded-lg hover:bg-blue-700">
              📥 ファイルを開く
            </a>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
