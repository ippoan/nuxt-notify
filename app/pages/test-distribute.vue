<script setup lang="ts">
const { apiFetch } = useApi()

interface Recipient {
  id: string
  name: string
  provider: 'line' | 'lineworks'
  lineworks_user_id: string | null
  line_user_id: string | null
  phone_number: string | null
  email: string | null
  enabled: boolean
}

const message = ref('📨 テスト配信メッセージです。\n\nこのメッセージが届いていれば配信システムは正常に動作しています。')
const sending = ref(false)
const result = ref<{ sent: number; failed: number; total: number } | null>(null)
const error = ref('')

const recipients = ref<Recipient[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<Set<string>>(new Set())

const enabledRecipients = computed(() => recipients.value.filter(r => r.enabled))

async function loadRecipients() {
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
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selected.value = next
}

function selectAll() {
  selected.value = new Set(enabledRecipients.value.map(r => r.id))
}

function clearAll() {
  selected.value = new Set()
}

async function send() {
  sending.value = true
  result.value = null
  error.value = ''
  try {
    result.value = await apiFetch('/notify/test-distribute', {
      method: 'POST',
      body: JSON.stringify({
        message: message.value,
        recipient_ids: [...selected.value],
      }),
    })
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    sending.value = false
  }
}

onMounted(loadRecipients)
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">テスト配信</h2>
    <p class="text-sm text-gray-500 mb-4">
      選択した受信者にテストメッセージを送信します。
    </p>

    <div class="bg-white rounded-lg shadow p-4 border mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-2">メッセージ</label>
      <textarea v-model="message" rows="5"
                class="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="配信するメッセージを入力..." />
    </div>

    <div class="bg-white rounded-lg shadow p-4 border mb-4">
      <div class="flex items-center justify-between mb-3">
        <label class="text-sm font-medium text-gray-700">送信先</label>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500">
            {{ selected.size }} / {{ enabledRecipients.length }} 人 選択中
          </span>
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

      <div v-if="loading" class="text-sm text-gray-500 py-4 text-center">
        受信者を読み込み中...
      </div>
      <div v-else-if="loadError" class="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
        {{ loadError }}
      </div>
      <div v-else-if="enabledRecipients.length === 0" class="text-sm text-gray-500 py-4 text-center">
        有効な受信者がいません。<NuxtLink to="/recipients" class="text-blue-600 hover:underline">受信者管理</NuxtLink>から登録してください。
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
    </div>

    <button @click="send"
            :disabled="sending || !message.trim() || selected.size === 0"
            class="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
      {{ sending ? '送信中...' : `🚀 テスト送信 (${selected.size} 人)` }}
    </button>

    <!-- 結果 -->
    <div v-if="result" class="bg-white rounded-lg shadow p-4 border mt-4">
      <h3 class="font-bold mb-2">送信結果</h3>
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-green-600">{{ result.sent }}</div>
          <div class="text-xs text-gray-500">成功</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-red-600">{{ result.failed }}</div>
          <div class="text-xs text-gray-500">失敗</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-gray-600">{{ result.total }}</div>
          <div class="text-xs text-gray-500">合計</div>
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-4 bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
      {{ error }}
    </div>
  </div>
</template>
