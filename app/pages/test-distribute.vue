<script setup lang="ts">
const { apiFetch } = useApi()

const message = ref('📨 テスト配信メッセージです。\n\nこのメッセージが届いていれば配信システムは正常に動作しています。')
const sending = ref(false)
const result = ref<{ sent: number; failed: number; total: number } | null>(null)
const error = ref('')

async function send() {
  sending.value = true
  result.value = null
  error.value = ''
  try {
    result.value = await apiFetch('/notify/test-distribute', {
      method: 'POST',
      body: JSON.stringify({ message: message.value }),
    })
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">テスト配信</h2>
    <p class="text-sm text-gray-500 mb-4">
      登録済みの全受信者（有効）にテストメッセージを送信します。
    </p>

    <div class="bg-white rounded-lg shadow p-4 border mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-2">メッセージ</label>
      <textarea v-model="message" rows="5"
                class="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="配信するメッセージを入力..." />

      <button @click="send" :disabled="sending || !message.trim()"
              class="mt-3 bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
        {{ sending ? '送信中...' : '🚀 テスト送信' }}
      </button>
    </div>

    <!-- 結果 -->
    <div v-if="result" class="bg-white rounded-lg shadow p-4 border">
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
