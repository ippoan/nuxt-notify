<script setup lang="ts">
const emit = defineEmits<{ uploaded: [count: number] }>()

const { uploadFetch } = useApi()
const { pick } = useFilePicker()

const state = ref<'idle' | 'uploading'>('idle')
const error = ref('')

const MAX_FILES = 20
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

async function onClick() {
  if (state.value === 'uploading') return
  error.value = ''

  let files: File[]
  try {
    files = await pick()
  } catch (e: any) {
    error.value = e?.message || String(e)
    return
  }
  if (files.length === 0) return

  if (files.length > MAX_FILES) {
    error.value = `ファイル数は最大 ${MAX_FILES} 件までです (${files.length} 件選択)`
    return
  }
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > MAX_TOTAL_BYTES) {
    error.value = `合計サイズが上限 (${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB) を超えています`
    return
  }

  const fd = new FormData()
  for (const f of files) fd.append('file', f, f.name)

  state.value = 'uploading'
  try {
    const res = await uploadFetch<{ count: number }>('/notify/documents/upload', fd)
    emit('uploaded', res.count)
  } catch (e: any) {
    const status = e?.response?.status ?? e?.statusCode ?? ''
    error.value = `アップロードに失敗しました${status ? ` (HTTP ${status})` : ''}`
  } finally {
    state.value = 'idle'
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button type="button" :disabled="state === 'uploading'"
            class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="onClick">
      {{ state === 'uploading' ? 'アップロード中…' : 'ファイルから取り込み' }}
    </button>
    <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
  </div>
</template>
