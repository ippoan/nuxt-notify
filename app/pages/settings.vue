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
const generating = ref(false)
const publicKeyPem = ref('')

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

/** Web Crypto API で RSA 鍵ペアを生成 */
async function generateKeyPair() {
  generating.value = true
  error.value = ''
  publicKeyPem.value = ''
  try {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true, // extractable
      ['sign', 'verify'],
    )

    // 公開鍵 → JWK JSON (LINE Console に貼る)
    const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    // LINE が要求する形式: {"kty":"RSA","alg":"RS256","use":"sig","e":"...","n":"..."}
    publicKeyPem.value = JSON.stringify({
      kty: pubJwk.kty,
      alg: 'RS256',
      use: 'sig',
      e: pubJwk.e,
      n: pubJwk.n,
    }, null, 2)

    // 秘密鍵 → PEM (フォームに自動入力)
    const privDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    form.private_key = derToPem(privDer, 'PRIVATE KEY')

    success.value = '鍵ペアを生成しました。公開鍵を LINE Developers Console に登録してください。'
  } catch (e: any) {
    error.value = '鍵生成失敗: ' + (e.message || String(e))
  } finally {
    generating.value = false
  }
}

function derToPem(der: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)))
  const lines = b64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

async function copyPublicKey() {
  await navigator.clipboard.writeText(publicKeyPem.value)
  success.value = '公開鍵をクリップボードにコピーしました'
}

function downloadPublicKey() {
  const blob = new Blob([publicKeyPem.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'line-public-key.jwk.json'
  a.click()
  URL.revokeObjectURL(url)
}

function downloadPrivateKey() {
  const blob = new Blob([form.private_key], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'line-private-key.pem'
  a.click()
  URL.revokeObjectURL(url)
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
    form.channel_secret = ''
    form.private_key = ''
    publicKeyPem.value = ''
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
    publicKeyPem.value = ''
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

      <!-- Step 1: 鍵ペア生成 -->
      <div class="bg-white rounded-lg shadow border p-4">
        <h3 class="font-medium mb-3">Step 1: 鍵ペア生成</h3>
        <p class="text-sm text-gray-500 mb-3">
          RSA 鍵ペアを生成し、公開鍵を LINE Developers Console に登録します。
        </p>
        <button @click="generateKeyPair" :disabled="generating"
                class="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
          {{ generating ? '生成中...' : '鍵ペアを生成' }}
        </button>

        <!-- 公開鍵表示 -->
        <div v-if="publicKeyPem" class="mt-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">
            公開鍵 JWK (LINE Developers Console にコピー)
          </label>
          <textarea :value="publicKeyPem" readonly rows="7"
                    class="w-full border rounded px-3 py-2 text-xs font-mono bg-yellow-50 select-all" />
          <div class="mt-2 flex gap-2 flex-wrap">
            <button @click="copyPublicKey"
                    class="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600">
              コピー
            </button>
            <button @click="downloadPublicKey"
                    class="bg-gray-500 text-white px-3 py-1 rounded text-xs hover:bg-gray-600">
              ダウンロード (公開鍵)
            </button>
            <button @click="downloadPrivateKey"
                    class="bg-orange-500 text-white px-3 py-1 rounded text-xs hover:bg-orange-600">
              ダウンロード (秘密鍵)
            </button>
            <a href="https://developers.line.biz/console/" target="_blank"
               class="text-blue-600 text-xs underline leading-6">
              LINE Developers Console を開く
            </a>
          </div>
          <p class="text-xs text-gray-500 mt-2">
            1. LINE Developers Console → チャネル → Messaging API設定<br>
            2. 「アサーション署名キー」→「公開鍵を登録する」をクリック<br>
            3. 上の公開鍵を貼り付けて「登録」<br>
            4. 表示される kid をコピーして下の「kid」欄に入力
          </p>
        </div>
      </div>

      <!-- Step 2: 設定入力 -->
      <div class="bg-white rounded-lg shadow border p-4">
        <h3 class="font-medium mb-3">Step 2: 設定を入力</h3>

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
            <p class="text-xs text-gray-400 mt-1">チャネル基本設定 → チャネルシークレット</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">kid (公開鍵登録後に表示される)</label>
            <input v-model="form.key_id" class="w-full border rounded px-3 py-2 text-sm font-mono"
                   placeholder="公開鍵を登録すると表示されます">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">秘密鍵 (PEM)</label>
            <textarea v-model="form.private_key" rows="4"
                      class="w-full border rounded px-3 py-2 text-xs font-mono bg-gray-50"
                      :placeholder="publicKeyPem ? '(Step 1 で自動入力済み)' : '-----BEGIN PRIVATE KEY-----'"
                      :class="{ 'bg-green-50': form.private_key && publicKeyPem }" />
            <p v-if="form.private_key && publicKeyPem" class="text-xs text-green-600 mt-1">✓ Step 1 で生成済み</p>
          </div>
        </div>

        <div class="mt-4">
          <button @click="save"
                  :disabled="saving || !form.name || !form.channel_id || !form.key_id || !form.private_key || !form.channel_secret"
                  class="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>

      <!-- Webhook URL -->
      <div class="bg-gray-50 border rounded-lg p-4">
        <h3 class="font-medium mb-2">Step 3: Webhook URL</h3>
        <p class="text-sm text-gray-500 mb-2">LINE Developers Console の Webhook URL に以下を設定:</p>
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
