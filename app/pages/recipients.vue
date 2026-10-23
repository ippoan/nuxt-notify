<script setup lang="ts">
import { bpReportChecked, bpReportDisabledReason } from '~/utils/bpReport'
import {
  createAlertMemberStore,
  alertCheckDisabledReason,
  canResend,
  emailStatusClass,
  emailStatusLabel,
  emailStatusNote,
  loadEmailStatuses,
  resendVerification,
  sendAlertTest,
  alertTestMessage,
  BP_REPORT_OPT_OUT_GROUP_NAME,
  type EmailStatus,
  type ApiFetch,
} from '~/utils/alertRecipients'
import {
  employeeLabel,
  linkEmployeesByName,
  linkedEmployeeText,
  linkResultMessage,
  loadEmployees,
  setRecipientEmployee,
  skipReasonLabel,
  takenEmployeeIds,
  type Employee,
  type LinkPlan,
} from '~/utils/employeeLink'
import {
  isRecipientFormValid,
  providerClass,
  providerIds,
  providerLabel,
  recipientErrorMessage,
  type RecipientProvider,
} from '~/utils/recipientProvider'

const { apiFetch } = useApi()
const alertFetch = apiFetch as ApiFetch

interface Recipient {
  id: string
  name: string
  provider: RecipientProvider
  lineworks_user_id: string | null
  line_user_id: string | null
  phone_number: string | null
  email: string | null
  enabled: boolean
  employee_id: string | null
}

const recipients = ref<Recipient[]>([])
const loading = ref(true)
const error = ref('')

// フォーム
const showForm = ref(false)
const form = reactive({
  name: '',
  provider: 'line' as RecipientProvider,
  line_user_id: '',
  lineworks_user_id: '',
  phone_number: '',
  email: '',
})

// アルコール検知メールの受け取り手 (グループは画面に出さない) と送り先の状態
const alertMembers = ref<Set<string>>(new Set())
const emailStatuses = ref<Map<string, EmailStatus>>(new Map())
const alertError = ref('')
const resendResults = ref<Record<string, { ok: boolean; message: string }>>({})

// 状態の取得失敗は一覧を潰さない (状態は「-」)。load の try とは別に包む。
async function loadStatuses() {
  try {
    emailStatuses.value = await loadEmailStatuses(alertFetch)
  } catch {
    emailStatuses.value = new Map()
  }
}

// 血圧の日報メール (毎朝 7:00) はオプトアウト: 受け取れる人 (管理者) は既定でチェックあり、
// チェックを外すと「受け取らない」グループに入れる (グループは画面に出さない)。bpOptOut はそのグループのメンバー
const bpOptOut = ref<Set<string>>(new Set())
const bpError = ref('')
const bpStore = createAlertMemberStore(
  alertFetch,
  (members) => (bpOptOut.value = members),
  (message) => (bpError.value = message),
  { groupName: BP_REPORT_OPT_OUT_GROUP_NAME, label: '血圧の日報' },
)

// 宛先と社員マスタの結び付け (血圧の結果を測った本人へ LINE WORKS で送るため)
const employees = ref<Employee[]>([])
const employeeById = computed(() => new Map(employees.value.map((e) => [e.id, e])))
const employeeError = ref('')
const linkMessage = ref<{ ok: boolean; message: string } | null>(null)

// 社員の一覧の取得失敗は一覧を潰さない (管理者でなければ 403)。
async function loadEmployeeList() {
  employeeError.value = ''
  try {
    employees.value = await loadEmployees(alertFetch)
  } catch {
    employees.value = []
    employeeError.value = '社員の一覧を読み込めませんでした (管理者だけが結び付けできます)'
  }
}

function employeeOptionDisabled(r: Recipient, e: Employee): boolean {
  return takenEmployeeIds(recipients.value, r.id).has(e.id)
}

async function changeEmployee(r: Recipient, value: string) {
  linkMessage.value = null
  const res = await setRecipientEmployee(alertFetch, r.id, value || null)
  if (!res.ok) linkMessage.value = { ok: false, message: res.message }
  await load()
}

// 氏名で社員と結び付ける: 候補 (dry_run) を見せて、確認してから確定する
const linkPlan = ref<LinkPlan | null>(null)
const linkBusy = ref(false)

async function previewLink() {
  linkMessage.value = null
  linkBusy.value = true
  try {
    const res = await linkEmployeesByName(alertFetch, true)
    if (res.ok) linkPlan.value = res.value
    else linkMessage.value = { ok: false, message: res.message }
  } finally {
    linkBusy.value = false
  }
}

async function commitLink() {
  linkBusy.value = true
  try {
    const res = await linkEmployeesByName(alertFetch, false)
    linkMessage.value = res.ok
      ? { ok: true, message: linkResultMessage(res.value) }
      : { ok: false, message: res.message }
    linkPlan.value = null
  } finally {
    linkBusy.value = false
  }
  await load()
}

function cancelLink() {
  linkPlan.value = null
}

const alertStore = createAlertMemberStore(
  alertFetch,
  (members) => (alertMembers.value = members),
  (message) => (alertError.value = message),
)
const loadAlertState = () => alertStore.load()

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
  alertError.value = ''
  bpError.value = ''
  await Promise.all([loadAlertState(), bpStore.load(), loadStatuses(), loadEmployeeList()])
}

async function toggleAlert(r: Recipient, checked: boolean) {
  alertError.value = ''
  await alertStore.toggle(r.id, checked)
}

async function toggleBp(r: Recipient, checked: boolean) {
  bpError.value = ''
  // チェックあり = グループに入っていない。外したらグループに入れ、付けたらグループから外す
  await bpStore.toggle(r.id, !checked)
}

async function resend(r: Recipient) {
  resendResults.value = { ...resendResults.value, [r.id]: await resendVerification(alertFetch, r.id) }
  await loadStatuses()
}

// アルコール検知メールのテスト送信 (チェック済みの人全員へ)
const alertTesting = ref(false)
const alertTestResult = ref<{ ok: boolean; message: string } | null>(null)

async function sendTest() {
  if (!confirm(`アルコール検知メールのテストを ${alertMembers.value.size} 人に送ります。よろしいですか？`)) return
  alertTesting.value = true
  alertTestResult.value = null
  try {
    const res = await sendAlertTest(alertFetch)
    alertTestResult.value = { ok: res.ok, message: alertTestMessage(res) }
  } finally {
    alertTesting.value = false
  }
}

async function create() {
  try {
    await apiFetch('/notify/recipients', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        provider: form.provider,
        ...providerIds(form),
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
    alert('作成失敗: ' + (recipientErrorMessage(e) ?? (e.message || String(e))))
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
    alert('更新失敗: ' + (recipientErrorMessage(e) ?? (e.message || String(e))))
  }
}

const editingId = ref<string | null>(null)
const editName = ref('')
const editEmail = ref('')

function startEdit(r: Recipient) {
  editingId.value = r.id
  editName.value = r.name
  editEmail.value = r.email ?? ''
}

async function saveName(r: Recipient) {
  if (!editName.value.trim()) return
  try {
    await apiFetch(`/notify/recipients/${r.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editName.value.trim(), email: editEmail.value.trim() || null }),
    })
    editingId.value = null
    await load()
  } catch (e: any) {
    alert('更新失敗: ' + (recipientErrorMessage(e) ?? (e.message || String(e))))
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
            <option value="email">メール</option>
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
          <label class="block text-sm font-medium text-gray-700 mb-1">
            メール<span v-if="form.provider === 'email'" class="text-red-500"> *必須</span>
          </label>
          <input v-model="form.email" class="w-full border rounded px-3 py-2 text-sm" placeholder="user@example.com">
        </div>
      </div>
      <button @click="create" :disabled="!isRecipientFormValid(form)"
              class="mt-3 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
        登録
      </button>
    </div>

    <div v-if="alertError" class="text-red-500 text-sm mb-2">{{ alertError }}</div>
    <div v-if="bpError" class="text-red-500 text-sm mb-2">{{ bpError }}</div>
    <div v-if="employeeError" class="text-amber-600 text-sm mb-2">{{ employeeError }}</div>

    <div class="flex items-center gap-3 mb-2">
      <button @click="sendTest" :disabled="alertMembers.size === 0 || alertTesting"
              class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
        {{ alertTesting ? '送信中...' : 'アルコール検知メールのテスト送信' }}
      </button>
      <span v-if="alertTestResult" class="text-sm"
            :class="alertTestResult.ok ? 'text-green-600' : 'text-red-500'">
        {{ alertTestResult.message }}
      </span>
    </div>

    <!-- 氏名での社員との結び付け -->
    <div class="flex items-center gap-3 mb-2">
      <button @click="previewLink" :disabled="linkBusy || employees.length === 0"
              class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
        {{ linkBusy && !linkPlan ? '確認中...' : '氏名で社員と結び付ける' }}
      </button>
      <span v-if="linkMessage" class="text-sm" :class="linkMessage.ok ? 'text-green-600' : 'text-red-500'">
        {{ linkMessage.message }}
      </span>
    </div>

    <div v-if="linkPlan" class="bg-white rounded-lg shadow p-4 mb-4 border text-sm">
      <p class="mb-2 text-gray-600">
        宛先と社員の名前を、空白 (半角・全角) を除いて比べます。同じ名前の社員がちょうど 1 人で、宛先も社員もまだ結び付いていないものだけを結びます。
      </p>
      <h3 class="font-bold mb-1">結び付ける ({{ linkPlan.candidates.length }} 件)</h3>
      <ul v-if="linkPlan.candidates.length" class="mb-3">
        <li v-for="c in linkPlan.candidates" :key="c.recipient_id">
          {{ c.recipient_name }} ↔ {{ employeeLabel({ name: c.employee_name, code: c.employee_code }) }}
        </li>
      </ul>
      <p v-else class="mb-3 text-gray-400">結び付けられる宛先はありません</p>
      <h3 v-if="linkPlan.skipped.length" class="font-bold mb-1">結べない宛先 ({{ linkPlan.skipped.length }} 件)</h3>
      <ul v-if="linkPlan.skipped.length" class="mb-3 text-gray-500">
        <li v-for="s in linkPlan.skipped" :key="s.recipient_id">
          {{ s.recipient_name }}: {{ skipReasonLabel(s.reason) }}
        </li>
      </ul>
      <div class="flex gap-2">
        <button v-if="linkPlan.candidates.length" @click="commitLink" :disabled="linkBusy"
                class="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
          {{ linkBusy ? '結び付け中...' : `${linkPlan.candidates.length} 件を結び付ける` }}
        </button>
        <button @click="cancelLink" :disabled="linkBusy"
                class="px-4 py-2 rounded text-sm border hover:bg-gray-50 disabled:opacity-50">
          キャンセル
        </button>
      </div>
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
          <th class="px-4 py-2 text-left">メール</th>
          <th class="px-4 py-2 text-left">社員</th>
          <th class="px-4 py-2 text-center">アルコール検知メール</th>
          <th class="px-4 py-2 text-center">血圧の日報</th>
          <th class="px-4 py-2 text-center">有効</th>
          <th class="px-4 py-2 text-center">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in recipients" :key="r.id" class="border-t">
          <td class="px-4 py-2">
            <div v-if="editingId === r.id" class="flex gap-1 items-center">
              <input v-model="editName" @keyup.enter="saveName(r)" @keyup.escape="cancelEdit"
                     class="border rounded px-2 py-1 text-sm w-32" placeholder="名前" autofocus />
              <input v-model="editEmail" @keyup.enter="saveName(r)" @keyup.escape="cancelEdit"
                     class="border rounded px-2 py-1 text-sm w-48" placeholder="メール" />
              <button @click="saveName(r)" class="text-green-600 text-xs">✓</button>
              <button @click="cancelEdit" class="text-gray-400 text-xs">✕</button>
            </div>
            <span v-else @click="startEdit(r)" class="cursor-pointer hover:text-blue-600"
                  title="クリックで編集">{{ r.name }}</span>
          </td>
          <td class="px-4 py-2">
            <span :class="providerClass(r.provider)" class="font-medium">
              {{ providerLabel(r.provider) }}
            </span>
          </td>
          <td class="px-4 py-2 font-mono text-xs text-gray-500">
            {{ r.line_user_id || r.lineworks_user_id || '-' }}
          </td>
          <td class="px-4 py-2">{{ r.phone_number || '-' }}</td>
          <td class="px-4 py-2">
            <div v-if="r.email">{{ r.email }}</div>
            <div v-else class="text-gray-400">-</div>
            <template v-if="r.email">
              <div :class="emailStatusClass(emailStatuses.get(r.id))" class="text-xs font-medium">
                {{ emailStatusLabel(emailStatuses.get(r.id)) }}
              </div>
              <div v-if="emailStatusNote(emailStatuses.get(r.id))" class="text-xs text-gray-500">
                {{ emailStatusNote(emailStatuses.get(r.id)) }}
              </div>
              <button v-if="canResend(emailStatuses.get(r.id))" @click="resend(r)"
                      class="text-blue-600 hover:text-blue-800 text-xs underline">確認メールを再送</button>
              <div v-if="resendResults[r.id]" class="text-xs"
                   :class="resendResults[r.id]?.ok ? 'text-green-600' : 'text-red-500'">
                {{ resendResults[r.id]?.message }}
              </div>
            </template>
          </td>
          <td class="px-4 py-2">
            <select :value="r.employee_id ?? ''" :disabled="employees.length === 0 && !r.employee_id"
                    @change="changeEmployee(r, ($event.target as HTMLSelectElement).value)"
                    class="border rounded px-2 py-1 text-sm max-w-48">
              <option value="">(未設定)</option>
              <option v-if="r.employee_id && !employeeById.has(r.employee_id)" :value="r.employee_id">
                {{ linkedEmployeeText(r.employee_id, employeeById) }}
              </option>
              <option v-for="e in employees" :key="e.id" :value="e.id" :disabled="employeeOptionDisabled(r, e)">
                {{ employeeLabel(e) }}
              </option>
            </select>
          </td>
          <td class="px-4 py-2 text-center">
            <input type="checkbox" :checked="alertMembers.has(r.id)" :disabled="!r.email"
                   :title="alertCheckDisabledReason(r.email)"
                   @change="toggleAlert(r, ($event.target as HTMLInputElement).checked)" />
          </td>
          <td class="px-4 py-2 text-center">
            <input type="checkbox" :checked="bpReportChecked(r, bpOptOut, employeeById)"
                   :disabled="bpReportDisabledReason(r, employeeById) !== ''"
                   :title="bpReportDisabledReason(r, employeeById)"
                   @change="toggleBp(r, ($event.target as HTMLInputElement).checked)" />
          </td>
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
