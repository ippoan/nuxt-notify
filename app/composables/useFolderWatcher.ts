import { folderWatchDb, type SeenRow, type ExcludedRow } from '~/utils/folderWatchDb'
import { useApi } from '~/composables/useApi'

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg']
export const POLL_INTERVAL_OPTIONS = [10, 30, 60] as const
export type PollIntervalSec = (typeof POLL_INTERVAL_OPTIONS)[number]

const MAX_FILE_BYTES = 25 * 1024 * 1024

export interface UploadResponse {
  document_ids: string[]
  count: number
}

export interface PendingFile {
  key: string
  name: string
  size: number
  mtime: number
  file: File
}

interface FolderWatcherOptions {
  upload?: (path: string, fd: FormData) => Promise<UploadResponse>
  /** ms 単位の interval setter (テスト差し替え用) */
  setIntervalImpl?: typeof setInterval
  clearIntervalImpl?: typeof clearInterval
}

function isAllowedExt(name: string): boolean {
  const lower = name.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

function makeSeenKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

export function useFolderWatcher(options: FolderWatcherOptions = {}) {
  const upload = options.upload ?? ((path, fd) => useApi().uploadFetch<UploadResponse>(path, fd))
  const setIntervalFn = options.setIntervalImpl ?? setInterval
  const clearIntervalFn = options.clearIntervalImpl ?? clearInterval

  const dirHandle = ref<FileSystemDirectoryHandle | null>(null)
  const dirName = ref<string>('')
  const isWatching = ref(false)
  const isScanning = ref(false)
  const isUploading = ref(false)
  const needsResume = ref(false) // 起動直後に handle はあるが permission 未取得
  const error = ref('')

  const pollIntervalSec = ref<PollIntervalSec>(10)
  const seen = ref<SeenRow[]>([])
  const excluded = ref<ExcludedRow[]>([])
  /** スキャンで検出されたがユーザーがまだアップロードしていないファイル (in-memory) */
  const pending = ref<PendingFile[]>([])

  let timer: ReturnType<typeof setInterval> | null = null

  async function refreshLists() {
    seen.value = (await folderWatchDb.listSeen()).sort((a, b) => b.at - a.at)
    excluded.value = (await folderWatchDb.listExcluded()).sort((a, b) => b.at - a.at)
  }

  /** 初期化: 保存済み handle があれば「再開」状態にする */
  async function init() {
    await refreshLists()
    const dir = await folderWatchDb.getDir()
    if (!dir) return
    dirHandle.value = dir.handle
    dirName.value = dir.name
    needsResume.value = true
  }

  async function pickFolder() {
    error.value = ''
    const w = globalThis as unknown as {
      showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>
    }
    if (typeof w.showDirectoryPicker !== 'function') {
      error.value = 'このブラウザは showDirectoryPicker をサポートしていません'
      return
    }
    let handle: FileSystemDirectoryHandle
    try {
      handle = await w.showDirectoryPicker({ mode: 'read' })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      error.value = e instanceof Error ? e.message : String(e)
      return
    }
    const wasWatching = isWatching.value
    // 別フォルダに切り替わるので、旧フォルダ由来の pending は破棄
    pending.value = []
    dirHandle.value = handle
    dirName.value = handle.name
    await folderWatchDb.setDir(handle, handle.name)
    needsResume.value = false
    // 既に監視中なら timer は新しい dirHandle を使い続けるので
    // 1 回だけ即時スキャンして新フォルダを反映する。
    // 未監視なら startWatching が timer + 初回スキャンを起動する。
    if (wasWatching) await scanNow()
    else await startWatching()
  }

  async function ensurePermission(): Promise<boolean> {
    const h = dirHandle.value as unknown as {
      queryPermission?: (opts: { mode: 'read' }) => Promise<PermissionState>
      requestPermission?: (opts: { mode: 'read' }) => Promise<PermissionState>
    }
    if (typeof h.queryPermission === 'function') {
      const cur = await h.queryPermission({ mode: 'read' })
      if (cur === 'granted') return true
    }
    if (typeof h.requestPermission === 'function') {
      const req = await h.requestPermission({ mode: 'read' })
      return req === 'granted'
    }
    return true // ブラウザに API が無ければ素通し (本番では Chromium 想定)
  }

  async function resumeWatch() {
    error.value = ''
    if (!dirHandle.value) return
    const ok = await ensurePermission()
    if (!ok) {
      error.value = '権限が許可されませんでした'
      return
    }
    needsResume.value = false
    await startWatching()
  }

  async function startWatching() {
    if (isWatching.value) return
    isWatching.value = true
    timer = setIntervalFn(() => {
      void scanNow()
    }, pollIntervalSec.value * 1000)
    await scanNow()
  }

  function stopWatch() {
    isWatching.value = false
    if (timer) {
      clearIntervalFn(timer)
      timer = null
    }
  }

  async function unwatchFolder() {
    stopWatch()
    await folderWatchDb.clearDir()
    dirHandle.value = null
    dirName.value = ''
    needsResume.value = false
    pending.value = []
  }

  function setPollInterval(sec: PollIntervalSec) {
    pollIntervalSec.value = sec
    if (!isWatching.value) return
    // 監視中なら interval を貼り直す (isWatching=true ⇒ timer は必ず非 null)
    clearIntervalFn(timer!)
    timer = setIntervalFn(() => {
      void scanNow()
    }, sec * 1000)
  }

  /**
   * フォルダを列挙し、新規ファイルを `pending` に追加する。
   * **アップロードは行わない** — ユーザーが `uploadPending` を呼ぶまで待つ。
   * サイズ超過は永続的に弾く必要があるので即 `seen` に failed として記録する。
   */
  async function scanNow() {
    if (!dirHandle.value || isScanning.value) return
    isScanning.value = true
    error.value = ''
    try {
      const entries = dirHandle.value as unknown as {
        values: () => AsyncIterable<{
          kind: 'file' | 'directory'
          name: string
          getFile?: () => Promise<File>
        }>
      }
      for await (const entry of entries.values()) {
        if (entry.kind !== 'file' || !entry.getFile) continue
        if (!isAllowedExt(entry.name)) continue
        if (await folderWatchDb.isExcluded(entry.name)) continue

        const file = await entry.getFile()
        if (file.size === 0) continue
        const key = makeSeenKey(file)
        if (await folderWatchDb.hasSeenKey(key)) continue
        if (pending.value.some((p) => p.key === key)) continue
        if (file.size > MAX_FILE_BYTES) {
          await folderWatchDb.addSeen({
            key,
            name: file.name,
            size: file.size,
            mtime: file.lastModified,
            status: 'failed',
            at: Date.now(),
            errorMessage: `25MB を超過 (${Math.round(file.size / 1024 / 1024)}MB)`,
          })
          continue
        }
        pending.value.push({ key, name: file.name, size: file.size, mtime: file.lastModified, file })
      }
      await refreshLists()
      // ループが完走したなら permission は granted で確定 → 「再開」UI を引っ込めて良い
      needsResume.value = false
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      isScanning.value = false
    }
  }

  /** pending 1 件をアップロードして seen に移す */
  async function uploadPending(key: string): Promise<boolean> {
    const i = pending.value.findIndex((p) => p.key === key)
    if (i < 0) return false
    const p = pending.value[i]!
    isUploading.value = true
    try {
      const fd = new FormData()
      fd.append('file', p.file, p.name)
      try {
        const res = await upload('/notify/documents/upload', fd)
        await folderWatchDb.addSeen({
          key: p.key,
          name: p.name,
          size: p.size,
          mtime: p.mtime,
          status: 'uploaded',
          at: Date.now(),
          documentId: res.document_ids[0],
        })
        pending.value.splice(i, 1)
        await refreshLists()
        return true
      } catch (e: unknown) {
        const errObj = e as { response?: { status?: number }; statusCode?: number; message?: string }
        const status = errObj?.response?.status ?? errObj?.statusCode
        await folderWatchDb.addSeen({
          key: p.key,
          name: p.name,
          size: p.size,
          mtime: p.mtime,
          status: 'failed',
          at: Date.now(),
          errorMessage: status ? `HTTP ${status}` : (errObj?.message ?? 'unknown error'),
        })
        pending.value.splice(i, 1)
        await refreshLists()
        return false
      }
    } finally {
      isUploading.value = false
    }
  }

  /** pending 全件を順次アップロード */
  async function uploadAllPending(): Promise<{ ok: number; failed: number }> {
    let ok = 0
    let failed = 0
    // splice しながら回ると index がずれるので key スナップショットで回す
    const keys = pending.value.map((p) => p.key)
    for (const key of keys) {
      const success = await uploadPending(key)
      if (success) ok++
      else failed++
    }
    return { ok, failed }
  }

  async function excludeName(name: string) {
    await folderWatchDb.addExcluded(name)
    // pending にあるものも即削除
    pending.value = pending.value.filter((p) => p.name !== name)
    await refreshLists()
  }

  async function unexcludeName(name: string) {
    await folderWatchDb.removeExcluded(name)
    await refreshLists()
  }

  async function clearProcessed() {
    await folderWatchDb.clearProcessed()
    await refreshLists()
  }

  return {
    // state
    dirName,
    isWatching,
    isScanning,
    isUploading,
    needsResume,
    error,
    pollIntervalSec,
    seen,
    excluded,
    pending,
    // actions
    init,
    pickFolder,
    resumeWatch,
    stopWatch,
    unwatchFolder,
    setPollInterval,
    scanNow,
    uploadPending,
    uploadAllPending,
    excludeName,
    unexcludeName,
    clearProcessed,
  }
}
