<script setup lang="ts">
import { POLL_INTERVAL_OPTIONS, type PollIntervalSec } from '~/composables/useFolderWatcher'

const emit = defineEmits<{ uploaded: [count: number] }>()

const watcher = useFolderWatcher()
const open = ref(false)

onMounted(async () => {
  await watcher.init()
})

const successCount = computed(() => watcher.seen.value.filter((s) => s.status === 'uploaded').length)
const failedSeen = computed(() => watcher.seen.value.filter((s) => s.status === 'failed'))

async function onScanClick() {
  const before = successCount.value
  await watcher.scanNow()
  const added = successCount.value - before
  if (added > 0) emit('uploaded', added)
}

function onIntervalChange(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value) as PollIntervalSec
  watcher.setPollInterval(v)
}
</script>

<template>
  <div class="inline-block relative">
    <div class="flex items-center gap-2">
      <button v-if="!watcher.dirName.value" type="button" @click="watcher.pickFolder()"
              class="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700">
        フォルダ監視を開始
      </button>

      <template v-else>
        <button type="button" @click="watcher.pickFolder()"
                title="クリックでフォルダを変更"
                class="text-sm text-gray-600 hover:text-blue-700 hover:underline cursor-pointer">
          📁 {{ watcher.dirName.value }}
        </button>
        <span class="text-sm">
          <span v-if="watcher.isWatching.value" class="text-emerald-600">● 監視中</span>
          <span v-else class="text-gray-400">○ 停止中</span>
        </span>
        <button v-if="watcher.needsResume.value" type="button" @click="watcher.resumeWatch()"
                class="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">
          再開
        </button>
        <button v-else-if="watcher.isWatching.value" type="button" @click="watcher.stopWatch()"
                class="px-2 py-1 text-xs bg-gray-300 text-gray-800 rounded hover:bg-gray-400">
          停止
        </button>
        <button type="button" @click="onScanClick" :disabled="watcher.isScanning.value"
                class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {{ watcher.isScanning.value ? 'スキャン中…' : '今すぐスキャン' }}
        </button>
        <button type="button" @click="open = !open"
                class="px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300">
          詳細
        </button>
      </template>
    </div>

    <div v-if="watcher.error.value" class="text-xs text-red-600 mt-1">{{ watcher.error.value }}</div>

    <div v-if="open && watcher.dirName.value" class="absolute right-0 z-10 mt-2 w-96 bg-white border rounded-lg shadow-lg p-3 text-sm">
      <div class="flex justify-between items-center mb-2">
        <span class="font-semibold">監視設定</span>
        <button type="button" @click="open = false" class="text-gray-400 hover:text-gray-600">×</button>
      </div>

      <label class="block mb-3">
        ポーリング間隔:
        <select :value="watcher.pollIntervalSec.value" @change="onIntervalChange"
                class="ml-1 border rounded px-2 py-0.5 text-xs">
          <option v-for="sec in POLL_INTERVAL_OPTIONS" :key="sec" :value="sec">{{ sec }} 秒</option>
        </select>
      </label>

      <div class="mb-3">
        <div class="font-semibold text-xs mb-1">アップロード成功 ({{ successCount }})</div>
        <ul class="text-xs text-gray-600 max-h-24 overflow-y-auto">
          <li v-for="s in watcher.seen.value.filter(x => x.status === 'uploaded').slice(0, 10)"
              :key="s.key" class="truncate">✓ {{ s.name }}</li>
        </ul>
      </div>

      <div v-if="failedSeen.length > 0" class="mb-3">
        <div class="font-semibold text-xs mb-1 text-red-600">失敗 ({{ failedSeen.length }})</div>
        <ul class="text-xs space-y-1 max-h-24 overflow-y-auto">
          <li v-for="s in failedSeen.slice(0, 10)" :key="s.key" class="flex items-center gap-1">
            <span class="text-red-600 truncate flex-1">⚠ {{ s.name }} ({{ s.errorMessage }})</span>
            <button type="button" @click="watcher.excludeName(s.name)"
                    class="text-xs text-gray-500 hover:text-gray-700">除外</button>
          </li>
        </ul>
      </div>

      <div v-if="watcher.excluded.value.length > 0" class="mb-3">
        <div class="font-semibold text-xs mb-1">除外リスト ({{ watcher.excluded.value.length }})</div>
        <ul class="text-xs space-y-1 max-h-24 overflow-y-auto">
          <li v-for="x in watcher.excluded.value" :key="x.key" class="flex items-center gap-1">
            <span class="text-gray-600 truncate flex-1">{{ x.key }}</span>
            <button type="button" @click="watcher.unexcludeName(x.key)"
                    class="text-xs text-blue-600 hover:text-blue-800">解除</button>
          </li>
        </ul>
      </div>

      <div class="flex justify-between items-center pt-2 border-t">
        <button type="button" @click="watcher.clearProcessed()"
                class="text-xs text-gray-500 hover:text-gray-700">処理履歴をクリア</button>
        <button type="button" @click="watcher.unwatchFolder()"
                class="text-xs text-red-600 hover:text-red-800">監視を解除</button>
      </div>
    </div>
  </div>
</template>
