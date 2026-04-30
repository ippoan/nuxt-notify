<script setup lang="ts">
const { apiFetch } = useApi()

interface Recipient {
  id: string
  name: string
  provider: 'line' | 'lineworks'
  enabled: boolean
}

const props = defineProps<{
  documentId: string
  fileName: string | null
}>()

const emit = defineEmits<{
  close: []
  distributed: [{ sent: number; failed: number; total: number }]
}>()

const recipients = ref<Recipient[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(true)
const loadError = ref('')
const sending = ref(false)
const sendError = ref('')

const enabledRecipients = computed(() => recipients.value.filter(r => r.enabled))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    recipients.value = await apiFetch('/notify/recipients')
  } catch (e: any) {
    loadError.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAll() {
  selected.value = new Set(enabledRecipients.value.map(r => r.id))
}

function clearAll() {
  selected.value = new Set()
}

async function submit() {
  if (selected.value.size === 0) return
  sending.value = true
  sendError.value = ''
  try {
    const result = await apiFetch<{ sent: number; failed: number; total: number }>(
      `/notify/documents/${props.documentId}/distribute`,
      {
        method: 'POST',
        body: JSON.stringify({ target: { recipient_ids: [...selected.value] } }),
      },
    )
    emit('distributed', result)
    emit('close')
  } catch (e: any) {
    sendError.value = e.message || String(e)
  } finally {
    sending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
       @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <!-- Header -->
      <div class="px-5 py-3 border-b flex items-center justify-between">
        <h3 class="font-bold">配信先を選択</h3>
        <button @click="emit('close')" class="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 overflow-y-auto flex-1">
        <div class="text-xs text-gray-500 mb-3 truncate">📄 {{ fileName ?? '(無名)' }}</div>

        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-600">
            {{ selected.size }} / {{ enabledRecipients.length }} 人 選択中
          </span>
          <div class="flex gap-2">
            <button @click="selectAll" type="button"
                    :disabled="enabledRecipients.length === 0"
                    class="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50">
              全選択
            </button>
            <button @click="clearAll" type="button"
                    :disabled="selected.size === 0"
                    class="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50">
              全解除
            </button>
          </div>
        </div>

        <div v-if="loading" class="text-sm text-gray-500 py-6 text-center">読み込み中...</div>
        <div v-else-if="loadError" class="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {{ loadError }}
        </div>
        <div v-else-if="enabledRecipients.length === 0"
             class="text-sm text-gray-500 py-6 text-center">
          有効な受信者がいません。
          <NuxtLink to="/recipients" class="text-blue-600 hover:underline">受信者管理</NuxtLink>
          から登録してください。
        </div>
        <ul v-else class="divide-y border rounded">
          <li v-for="r in enabledRecipients" :key="r.id"
              class="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
              @click="toggle(r.id)">
            <input type="checkbox" :checked="selected.has(r.id)"
                   @click.stop="toggle(r.id)"
                   class="w-4 h-4" />
            <span class="flex-1 text-sm">{{ r.name }}</span>
            <span :class="r.provider === 'line' ? 'text-green-600' : 'text-blue-600'"
                  class="text-xs font-medium">
              {{ r.provider === 'line' ? 'LINE' : 'LINE WORKS' }}
            </span>
          </li>
        </ul>

        <div v-if="sendError" class="mt-3 bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {{ sendError }}
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t flex items-center justify-end gap-2">
        <button @click="emit('close')" type="button"
                class="px-4 py-2 text-sm border rounded hover:bg-gray-50">
          キャンセル
        </button>
        <button @click="submit" type="button"
                :disabled="sending || selected.size === 0"
                class="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {{ sending ? '配信中...' : `配信 (${selected.size} 人)` }}
        </button>
      </div>
    </div>
  </div>
</template>
