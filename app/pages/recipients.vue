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

const recipients = ref<Recipient[]>([])
const loading = ref(true)
const error = ref('')

// フォーム
const showForm = ref(false)
const form = reactive({
  name: '',
  provider: 'line' as 'line' | 'lineworks',
  line_user_id: '',
  lineworks_user_id: '',
  phone_number: '',
  email: '',
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    recipients.value = await apiFetch('/notify/recipients')
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function create() {
  try {
    await apiFetch('/notify/recipients', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        provider: form.provider,
        line_user_id: form.provider === 'line' ? form.line_user_id || null : null,
        lineworks_user_id: form.provider === 'lineworks' ? form.lineworks_user_id || null : null,
        phone_number: form.phone_number || null,
        email: form.email || null,
      }),
    })
    showForm.value = false
    form.name = ''
    form.line_user_id = ''
    form.lineworks_user_id = ''
    form.phone_number = ''
    form.email = ''
    await load()
  } catch (e: any) {
    alert('作成失敗: ' + (e.message || String(e)))
  }
}

async function remove(id: string) {
  if (!confirm('削除しますか？')) return
  try {
    await apiFetch(`/notify/recipients/${id}`, { method: 'DELETE' })
    await load()
  } catch (e: any) {
    alert('削除失敗: ' + (e.message || String(e)))
  }
}

async function toggle(r: Recipient) {
  try {
    await apiFetch(`/notify/recipients/${r.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !r.enabled }),
    })
    await load()
  } catch (e: any) {
    alert('更新失敗: ' + (e.message || String(e)))
  }
}

const editingId = ref<string | null>(null)
const editName = ref('')

function startEdit(r: Recipient) {
  editingId.value = r.id
  editName.value = r.name
}

async function saveName(r: Recipient) {
  if (!editName.value.trim()) return
  try {
    await apiFetch(`/notify/recipients/${r.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editName.value.trim() }),
    })
    editingId.value = null
    await load()
  } catch (e: any) {
    alert('更新失敗: ' + (e.message || String(e)))
  }
}

function cancelEdit() {
  editingId.value = null
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold">受信者管理</h2>
      <button @click="showForm = !showForm"
              class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
        {{ showForm ? 'キャンセル' : '+ 追加' }}
      </button>
    </div>

    <!-- 追加フォーム -->
    <div v-if="showForm" class="bg-white rounded-lg shadow p-4 mb-4 border">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">名前</label>
          <input v-model="form.name" class="w-full border rounded px-3 py-2 text-sm" placeholder="山田太郎">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">プロバイダ</label>
          <select v-model="form.provider" class="w-full border rounded px-3 py-2 text-sm">
            <option value="line">LINE</option>
            <option value="lineworks">LINE WORKS</option>
          </select>
        </div>
        <div v-if="form.provider === 'line'">
          <label class="block text-sm font-medium text-gray-700 mb-1">LINE User ID</label>
          <input v-model="form.line_user_id" class="w-full border rounded px-3 py-2 text-sm" placeholder="U...">
        </div>
        <div v-if="form.provider === 'lineworks'">
          <label class="block text-sm font-medium text-gray-700 mb-1">LINE WORKS User ID</label>
          <input v-model="form.lineworks_user_id" class="w-full border rounded px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
          <input v-model="form.phone_number" class="w-full border rounded px-3 py-2 text-sm" placeholder="090-xxxx-xxxx">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">メール</label>
          <input v-model="form.email" class="w-full border rounded px-3 py-2 text-sm" placeholder="user@example.com">
        </div>
      </div>
      <button @click="create" :disabled="!form.name"
              class="mt-3 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
        登録
      </button>
    </div>

    <!-- 一覧 -->
    <div v-if="loading" class="text-gray-500">読み込み中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else-if="recipients.length === 0" class="text-gray-400">受信者が登録されていません</div>

    <table v-else class="w-full bg-white rounded-lg shadow border text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2 text-left">名前</th>
          <th class="px-4 py-2 text-left">プロバイダ</th>
          <th class="px-4 py-2 text-left">ID</th>
          <th class="px-4 py-2 text-left">電話番号</th>
          <th class="px-4 py-2 text-center">有効</th>
          <th class="px-4 py-2 text-center">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in recipients" :key="r.id" class="border-t">
          <td class="px-4 py-2">
            <div v-if="editingId === r.id" class="flex gap-1">
              <input v-model="editName" @keyup.enter="saveName(r)" @keyup.escape="cancelEdit"
                     class="border rounded px-2 py-1 text-sm w-32" autofocus />
              <button @click="saveName(r)" class="text-green-600 text-xs">✓</button>
              <button @click="cancelEdit" class="text-gray-400 text-xs">✕</button>
            </div>
            <span v-else @click="startEdit(r)" class="cursor-pointer hover:text-blue-600"
                  title="クリックで編集">{{ r.name }}</span>
          </td>
          <td class="px-4 py-2">
            <span :class="r.provider === 'line' ? 'text-green-600' : 'text-blue-600'" class="font-medium">
              {{ r.provider === 'line' ? 'LINE' : 'LINE WORKS' }}
            </span>
          </td>
          <td class="px-4 py-2 font-mono text-xs text-gray-500">
            {{ r.line_user_id || r.lineworks_user_id || '-' }}
          </td>
          <td class="px-4 py-2">{{ r.phone_number || '-' }}</td>
          <td class="px-4 py-2 text-center">
            <button @click="toggle(r)" :class="r.enabled ? 'bg-green-500' : 'bg-gray-300'"
                    class="w-10 h-5 rounded-full relative transition-colors">
              <span :class="r.enabled ? 'translate-x-5' : 'translate-x-0'"
                    class="block w-5 h-5 bg-white rounded-full shadow transform transition-transform" />
            </button>
          </td>
          <td class="px-4 py-2 text-center">
            <button @click="remove(r.id)" class="text-red-500 hover:text-red-700 text-xs">削除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
