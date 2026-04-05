<script setup lang="ts">
const { apiFetch } = useApi()

interface LineConfigResponse {
  id: string
  name: string
  channel_id: string
  enabled: boolean
  created_at: string
}

const runtimeConfig = useRuntimeConfig()
const apiBase = runtimeConfig.public.apiBase as string
const config = ref<LineConfigResponse | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')

const form = reactive({
  name: '',
  channel_id: '',
  channel_secret: '',
  key_id: '',
  private_key: '',
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    config.value = await apiFetch('/notify/line-config')
    if (config.value) {
      form.name = config.value.name
      form.channel_id = config.value.channel_id
    }
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    config.value = await apiFetch('/notify/line-config', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        channel_id: form.channel_id,
        channel_secret: form.channel_secret,
        key_id: form.key_id,
        private_key: form.private_key,
      }),
    })
    // secret fields はクリア (保存済み)
    form.channel_secret = ''
    form.private_key = ''
    success.value = '保存しました'
  } catch (e: any) {
    error.value = '保存失敗: ' + (e.message || String(e))
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('LINE 設定を削除しますか？')) return
  try {
    await apiFetch('/notify/line-config', { method: 'DELETE' })
    config.value = null
    form.name = ''
    form.channel_id = ''
    form.channel_secret = ''
    form.key_id = ''
    form.private_key = ''
    success.value = '削除しました'
  } catch (e: any) {
    error.value = '削除失敗: ' + (e.message || String(e))
  }
}

onMounted(load)
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">LINE 設定</h2>
    <p class="text-sm text-gray-500 mb-6">
      LINE Messaging API の JWT assertion 方式で設定します。
      <a href="https://developers.line.biz/ja/docs/messaging-api/generate-json-web-token/"
         target="_blank" class="text-blue-600 underline">LINE Developers ドキュメント</a>
    </p>

    <div v-if="loading" class="text-gray-500">読み込み中...</div>

    <div v-else class="space-y-4">
      <!-- 現在の設定 -->
      <div v-if="config" class="bg-green-50 border border-green-200 rounded-lg p-4">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-green-700 font-medium">✓ 設定済み</span>
            <span class="text-sm text-gray-500 ml-2">{{ config.name }} ({{ config.channel_id }})</span>
          </div>
          <button @click="remove" class="text-red-500 hover:text-red-700 text-sm">削除</button>
        </div>
      </div>

      <!-- フォーム -->
      <div class="bg-white rounded-lg shadow border p-4">
        <h3 class="font-medium mb-3">{{ config ? '設定を更新' : '新規設定' }}</h3>

        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">設定名</label>
            <input v-model="form.name" class="w-full border rounded px-3 py-2 text-sm"
                   placeholder="例: 通知Bot">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Channel ID</label>
            <input v-model="form.channel_id" class="w-full border rounded px-3 py-2 text-sm font-mono"
                   placeholder="1234567890">
            <p class="text-xs text-gray-400 mt-1">LINE Developers Console → チャネル基本設定</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Channel Secret</label>
            <input v-model="form.channel_secret" type="password"
                   class="w-full border rounded px-3 py-2 text-sm font-mono"
                   :placeholder="config ? '(変更する場合のみ入力)' : '32文字の英数字'">
            <p class="text-xs text-gray-400 mt-1">LINE Developers Console → チャネル基本設定 → チャネルシークレット</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Assertion Signing Key ID (kid)</label>
            <input v-model="form.key_id" class="w-full border rounded px-3 py-2 text-sm font-mono"
                   placeholder="例: 12345678-abcd-1234-abcd-123456789012">
            <p class="text-xs text-gray-400 mt-1">LINE Developers Console → Messaging API設定 → アサーション署名キー</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">秘密鍵 (PEM)</label>
            <textarea v-model="form.private_key" rows="6"
                      class="w-full border rounded px-3 py-2 text-sm font-mono"
                      :placeholder="config ? '(変更する場合のみ入力)' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'"></textarea>
            <p class="text-xs text-gray-400 mt-1">キーペア生成時にダウンロードした秘密鍵ファイルの内容</p>
          </div>
        </div>

        <div class="mt-4 flex gap-3">
          <button @click="save" :disabled="saving || !form.name || !form.channel_id || !form.key_id"
                  class="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>

      <!-- Webhook URL -->
      <div class="bg-gray-50 border rounded-lg p-4">
        <h3 class="font-medium mb-2">Webhook URL</h3>
        <p class="text-sm text-gray-500 mb-2">LINE Developers Console の Webhook URL に以下を設定してください:</p>
        <code class="block bg-white border rounded px-3 py-2 text-sm font-mono text-blue-700 select-all">
          {{ apiBase }}/api/notify/line/webhook
        </code>
        <p class="text-xs text-gray-400 mt-1">Webhookの利用を「ON」にしてください</p>
      </div>

      <!-- メッセージ -->
      <div v-if="success" class="bg-green-50 border border-green-200 rounded p-3 text-green-700 text-sm">{{ success }}</div>
      <div v-if="error" class="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{{ error }}</div>
    </div>
  </div>
</template>
