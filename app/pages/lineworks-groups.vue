<script setup lang="ts">
const { apiFetch } = useApi()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string

interface LineworksChannel {
  id: string
  tenant_id: string
  bot_config_id: string
  channel_id: string
  title: string | null
  channel_type: string | null
  joined_at: string
  active: boolean
}

interface BotConfig {
  id: string
  provider: string
  name: string
  bot_id: string
  enabled: boolean
}

const channels = ref<LineworksChannel[]>([])
const botConfigs = ref<BotConfig[]>([])
const loading = ref(true)
const error = ref('')
const showGuide = ref(true)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [chs, bots] = await Promise.all([
      apiFetch<LineworksChannel[]>('/notify/lineworks/channels'),
      apiFetch<{ configs: BotConfig[] }>('/admin/bot/configs'),
    ])
    channels.value = chs
    botConfigs.value = (bots.configs || []).filter(c => c.provider === 'lineworks' && c.enabled)
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  if (!confirm('このグループ登録を削除しますか？\n(LINE WORKS 側で Bot が招待されたままなら次回の発言で再登録される可能性があります)')) return
  try {
    await apiFetch(`/notify/lineworks/channels/${id}`, { method: 'DELETE' })
    await load()
  } catch (e: any) {
    alert('削除失敗: ' + (e.message || String(e)))
  }
}

async function testSend(ch: LineworksChannel) {
  const text = prompt(`「${ch.title || ch.channel_id}」にテスト送信するメッセージ:`, 'notify からのテスト送信です')
  if (!text) return
  try {
    await apiFetch(`/notify/lineworks/channels/${ch.id}/test-send`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    alert('送信しました')
  } catch (e: any) {
    alert('送信失敗: ' + (e.message || String(e)))
  }
}

function maskChannelId(id: string): string {
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', { hour12: false })
  } catch {
    return iso
  }
}

function webhookUrl(botId: string): string {
  return `${apiBase}/api/notify/lineworks/webhook/${botId}`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    // light visual feedback
    const el = document.activeElement as HTMLElement | null
    el?.blur()
  } catch {
    /* ignore */
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold">LINE WORKS グループ</h2>
      <button
        class="text-sm text-blue-600 hover:underline"
        @click="load"
      >
        🔄 更新
      </button>
    </div>

    <!-- 招待手順カード -->
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
      <div class="flex justify-between items-center">
        <h3 class="font-semibold text-amber-900">📖 招待手順</h3>
        <button
          class="text-xs text-amber-700 hover:underline"
          @click="showGuide = !showGuide"
        >
          {{ showGuide ? '隠す' : '表示' }}
        </button>
      </div>
      <div v-if="showGuide" class="mt-3 text-sm text-amber-900 space-y-3">
        <p>Bot 公式 API には「既存トークルームに Bot を追加する」エンドポイントがありません。
        手動で招待 → Bot が <code>joined</code> webhook を受信 → このページに表示、というフローです。</p>

        <ol class="list-decimal list-inside space-y-2 pl-2">
          <li>
            <a
              href="https://dev.worksmobile.com/jp/console/openapi/v2/app/list/view"
              target="_blank"
              class="text-blue-700 underline"
            >LINE WORKS Developers Console</a>
            で対象 Bot を開き、以下を有効化:
            <ul class="list-disc list-inside ml-6 mt-1 text-xs">
              <li><strong>Bot Secret</strong> を発行 (未発行なら)</li>
              <li><strong>Callback URL</strong> を以下に設定</li>
              <li><strong>Callback events</strong> から <code>join</code> / <code>leave</code> を ON</li>
              <li><strong>複数人トークルームへの招待</strong> を許可</li>
            </ul>
          </li>
          <li>
            <strong>Bot Secret を「配信設定」→ Bot 編集</strong>から登録 (Webhook 署名検証に必須)
          </li>
          <li>LINE WORKS アプリで対象トークルームを開く → メニュー → Bot を招待 → 当 Bot を選択</li>
          <li>数秒後、当ページの「更新」ボタンを押すと一覧に表示されます</li>
        </ol>

        <div v-if="botConfigs.length > 0" class="mt-3">
          <p class="text-xs font-semibold text-amber-800">📍 各 Bot の Callback URL (コピー):</p>
          <div v-for="b in botConfigs" :key="b.id" class="mt-1 flex items-center gap-2">
            <span class="text-xs text-amber-700 w-24 truncate">{{ b.name }}:</span>
            <code class="bg-white border border-amber-300 px-2 py-1 rounded text-xs flex-1 truncate">
              {{ webhookUrl(b.bot_id) }}
            </code>
            <button
              class="text-xs text-blue-600 hover:underline"
              @click="copyText(webhookUrl(b.bot_id))"
            >
              📋
            </button>
          </div>
        </div>
        <p v-else class="text-xs text-amber-700">
          ※ 「配信設定」で LINE WORKS Bot 設定を登録すると、ここに Callback URL が表示されます。
        </p>
      </div>
    </div>

    <!-- 一覧 -->
    <div v-if="loading" class="text-gray-500">読み込み中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else-if="channels.length === 0" class="bg-white rounded-lg shadow border p-6 text-center text-gray-400">
      まだ Bot が招待されたグループがありません。<br>
      上記の手順で LINE WORKS アプリから Bot を招待してください。
    </div>

    <table v-else class="w-full bg-white rounded-lg shadow border text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2 text-left">グループ名</th>
          <th class="px-4 py-2 text-left">channel_id</th>
          <th class="px-4 py-2 text-left">種別</th>
          <th class="px-4 py-2 text-left">招待日時</th>
          <th class="px-4 py-2 text-center">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ch in channels" :key="ch.id" class="border-t">
          <td class="px-4 py-2">{{ ch.title || '(名前未取得)' }}</td>
          <td class="px-4 py-2 font-mono text-xs text-gray-500" :title="ch.channel_id">
            {{ maskChannelId(ch.channel_id) }}
          </td>
          <td class="px-4 py-2 text-xs">{{ ch.channel_type || '-' }}</td>
          <td class="px-4 py-2 text-xs text-gray-500">{{ formatDate(ch.joined_at) }}</td>
          <td class="px-4 py-2 text-center space-x-2">
            <button
              class="text-blue-600 hover:text-blue-800 text-xs"
              @click="testSend(ch)"
            >
              📤 テスト送信
            </button>
            <button
              class="text-red-500 hover:text-red-700 text-xs"
              @click="remove(ch.id)"
            >
              削除
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
