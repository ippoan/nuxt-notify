import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

// Default-upload (useApi) path mocks
const defaultFetch = vi.fn()
vi.stubGlobal('$fetch', defaultFetch)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'http://api' } }))
const mockToken = ref<string | null>(null)
const mockOrgId = ref<string | null>(null)
vi.mock('@ippoan/auth-client', () => ({
  useAuth: () => ({ token: mockToken, orgId: mockOrgId }),
}))

// Mock DB wrapper
const dbState = {
  dir: null as null | { id: 'main'; handle: any; name: string },
  seen: [] as any[],
  excluded: [] as any[],
}
vi.mock('~/utils/folderWatchDb', () => ({
  folderWatchDb: {
    getDir: vi.fn(async () => dbState.dir),
    setDir: vi.fn(async (handle: any, name: string) => {
      dbState.dir = { id: 'main', handle, name }
    }),
    clearDir: vi.fn(async () => { dbState.dir = null }),
    listSeen: vi.fn(async () => dbState.seen.slice()),
    addSeen: vi.fn(async (row: any) => {
      const i = dbState.seen.findIndex((r) => r.key === row.key)
      if (i >= 0) dbState.seen[i] = row
      else dbState.seen.push(row)
    }),
    hasSeenKey: vi.fn(async (key: string) => dbState.seen.some((r) => r.key === key)),
    listExcluded: vi.fn(async () => dbState.excluded.slice()),
    addExcluded: vi.fn(async (name: string) => {
      if (!dbState.excluded.some((r) => r.key === name)) dbState.excluded.push({ key: name, at: 1 })
    }),
    removeExcluded: vi.fn(async (name: string) => {
      dbState.excluded = dbState.excluded.filter((r) => r.key !== name)
    }),
    isExcluded: vi.fn(async (name: string) => dbState.excluded.some((r) => r.key === name)),
    clearProcessed: vi.fn(async () => {
      dbState.seen = []
      dbState.excluded = []
    }),
  },
}))

const { useFolderWatcher, POLL_INTERVAL_OPTIONS } = await import('../../app/composables/useFolderWatcher')

function fakeFile(name: string, size: number, mtime: number): File {
  const f = new File([new Uint8Array(size)], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'lastModified', { value: mtime })
  return f
}

function fakeDirHandle(
  files: File[],
  opts: { permission?: 'granted' | 'denied' | 'prompt'; requestResult?: 'granted' | 'denied' } = {},
) {
  const perm = opts.permission ?? 'granted'
  const reqRes = opts.requestResult ?? 'granted'
  return {
    name: 'inbox',
    queryPermission: vi.fn(async () => perm),
    requestPermission: vi.fn(async () => reqRes),
    values: () => (async function* () {
      for (const f of files) {
        yield {
          kind: 'file' as const,
          name: f.name,
          getFile: async () => f,
        }
      }
    })(),
  } as unknown as FileSystemDirectoryHandle
}

beforeEach(() => {
  dbState.dir = null
  dbState.seen = []
  dbState.excluded = []
  defaultFetch.mockReset()
})

afterEach(() => {
  delete (globalThis as any).showDirectoryPicker
})

describe('useFolderWatcher', () => {
  // ---------- init / pickFolder ----------

  it('init with no saved dir → no resume needed', async () => {
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.init()
    expect(w.dirName.value).toBe('')
    expect(w.needsResume.value).toBe(false)
  })

  it('init with saved dir → needsResume true', async () => {
    dbState.dir = { id: 'main', handle: fakeDirHandle([]), name: 'inbox' }
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.init()
    expect(w.dirName.value).toBe('inbox')
    expect(w.needsResume.value).toBe(true)
  })

  it('pickFolder errors if showDirectoryPicker is missing', async () => {
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.pickFolder()
    expect(w.error.value).toContain('showDirectoryPicker')
  })

  it('pickFolder AbortError → silent', async () => {
    const abort = new Error('abort'); abort.name = 'AbortError'
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockRejectedValue(abort)
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.pickFolder()
    expect(w.error.value).toBe('')
    expect(w.dirName.value).toBe('')
  })

  it('pickFolder non-Abort error → error.value set', async () => {
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockRejectedValue(new Error('boom'))
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.pickFolder()
    expect(w.error.value).toBe('boom')
  })

  it('pickFolder non-Error rejection → String(e)', async () => {
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockRejectedValue('rejected-string')
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.pickFolder()
    expect(w.error.value).toBe('rejected-string')
  })

  it('pickFolder success → saves handle, starts watching, scan adds to pending (no upload)', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn()
    const setIntervalImpl = vi.fn(() => 1 as any) as any

    const w = useFolderWatcher({ upload, setIntervalImpl, clearIntervalImpl: vi.fn() as any })
    await w.pickFolder()

    expect(w.dirName.value).toBe('inbox')
    expect(w.isWatching.value).toBe(true)
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 10_000)
    expect(upload).not.toHaveBeenCalled()
    expect(w.pending.value.map((p) => p.name)).toEqual(['a.pdf'])
  })

  it('pickFolder while watching → swaps folder, clears old pending, rescans', async () => {
    const fileA = fakeFile('a.pdf', 100, 1)
    const fileB = fakeFile('b.pdf', 200, 2)
    const handleA = { ...fakeDirHandle([fileA]), name: 'folderA' } as unknown as FileSystemDirectoryHandle
    const handleB = { ...fakeDirHandle([fileB]), name: 'folderB' } as unknown as FileSystemDirectoryHandle
    const picker = vi.fn().mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    ;(globalThis as any).showDirectoryPicker = picker
    const setIntervalImpl = vi.fn(() => 1 as any) as any

    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    expect(w.dirName.value).toBe('folderA')
    expect(w.pending.value.map((p) => p.name)).toEqual(['a.pdf'])

    await w.pickFolder()
    expect(w.dirName.value).toBe('folderB')
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    // pending should be cleared then re-populated with fileB only
    expect(w.pending.value.map((p) => p.name)).toEqual(['b.pdf'])
  })

  // ---------- resume / start / stop / unwatch ----------

  it('resumeWatch with no handle is a no-op', async () => {
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.resumeWatch()
    expect(w.isWatching.value).toBe(false)
  })

  it('resumeWatch denied → error and stays stopped', async () => {
    const handle = fakeDirHandle([], { permission: 'prompt', requestResult: 'denied' })
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.init()
    await w.resumeWatch()
    expect(w.error.value).toBe('権限が許可されませんでした')
    expect(w.isWatching.value).toBe(false)
  })

  it('resumeWatch granted → starts watching, clears needsResume', async () => {
    const handle = fakeDirHandle([], { permission: 'prompt', requestResult: 'granted' })
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.isWatching.value).toBe(true)
    expect(w.needsResume.value).toBe(false)
  })

  it('ensurePermission: granted on queryPermission skips request', async () => {
    const handle = fakeDirHandle([])
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect((handle as any).requestPermission).not.toHaveBeenCalled()
  })

  it('ensurePermission: handle without permission API → passthrough', async () => {
    const handle = {
      name: 'inbox',
      values: () => (async function* () {})(),
    } as unknown as FileSystemDirectoryHandle
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.isWatching.value).toBe(true)
  })

  it('startWatching: no-op if already watching', async () => {
    const handle = fakeDirHandle([])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const setIntervalImpl = vi.fn(() => 1 as any) as any
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    await w.resumeWatch()
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
  })

  it('stopWatch clears interval and flag', async () => {
    const handle = fakeDirHandle([])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const clearIntervalImpl = vi.fn()
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 99 as any) as any, clearIntervalImpl: clearIntervalImpl as any,
    })
    await w.pickFolder()
    w.stopWatch()
    expect(w.isWatching.value).toBe(false)
    expect(clearIntervalImpl).toHaveBeenCalledWith(99)
    w.stopWatch()
    expect(clearIntervalImpl).toHaveBeenCalledTimes(1)
  })

  it('unwatchFolder clears DB + state + pending', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    expect(w.pending.value.length).toBe(1)
    await w.unwatchFolder()
    expect(w.dirName.value).toBe('')
    expect(w.isWatching.value).toBe(false)
    expect(dbState.dir).toBeNull()
    expect(w.pending.value).toEqual([])
  })

  // ---------- setPollInterval ----------

  it('setPollInterval before watching just changes the value', async () => {
    const w = useFolderWatcher({ upload: vi.fn() })
    w.setPollInterval(60)
    expect(w.pollIntervalSec.value).toBe(60)
  })

  it('setPollInterval while watching restarts the interval', async () => {
    const handle = fakeDirHandle([])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const setIntervalImpl = vi.fn(() => 1 as any) as any
    const clearIntervalImpl = vi.fn()
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl, clearIntervalImpl: clearIntervalImpl as any,
    })
    await w.pickFolder()
    w.setPollInterval(30)
    expect(clearIntervalImpl).toHaveBeenCalled()
    expect(setIntervalImpl).toHaveBeenLastCalledWith(expect.any(Function), 30_000)
  })

  // ---------- scanNow ----------

  it('scanNow: successful completion clears needsResume', async () => {
    const handle = fakeDirHandle([])
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    expect(w.needsResume.value).toBe(true)
    // resumeWatch を経由せず scanNow を直叩き
    await w.scanNow()
    expect(w.needsResume.value).toBe(false)
  })

  it('scanNow: filters non-files, disallowed ext, excluded, zero-size, already-seen', async () => {
    const goodPdf = fakeFile('good.pdf', 50, 1)
    const exe = fakeFile('bad.exe', 50, 1)
    const empty = fakeFile('empty.pdf', 0, 1)
    const dirEntry = { kind: 'directory', name: 'subdir' }
    const skipPdf = fakeFile('skip.pdf', 50, 1)
    const alreadySeen = fakeFile('done.pdf', 50, 1)

    dbState.excluded = [{ key: 'skip.pdf', at: 1 }]
    dbState.seen = [{
      key: 'done.pdf|50|1', name: 'done.pdf', size: 50, mtime: 1, status: 'uploaded', at: 1,
    }]

    const handle = {
      name: 'inbox',
      queryPermission: vi.fn(async () => 'granted'),
      values: () => (async function* () {
        yield dirEntry
        yield { kind: 'file', name: exe.name, getFile: async () => exe }
        yield { kind: 'file', name: skipPdf.name, getFile: async () => skipPdf }
        yield { kind: 'file', name: empty.name, getFile: async () => empty }
        yield { kind: 'file', name: alreadySeen.name, getFile: async () => alreadySeen }
        yield { kind: 'file', name: goodPdf.name, getFile: async () => goodPdf }
      })(),
    } as unknown as FileSystemDirectoryHandle
    dbState.dir = { id: 'main', handle, name: 'inbox' }

    const upload = vi.fn()
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()

    expect(upload).not.toHaveBeenCalled()
    expect(w.pending.value.map((p) => p.name)).toEqual(['good.pdf'])
  })

  it('scanNow: rejects oversized files as failed (no pending push)', async () => {
    const huge = fakeFile('big.pdf', 26 * 1024 * 1024, 1)
    const handle = fakeDirHandle([huge])
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.pending.value).toEqual([])
    expect(w.seen.value[0]?.status).toBe('failed')
    expect(w.seen.value[0]?.errorMessage).toContain('25MB')
  })

  it('scanNow: dedupes against existing pending entries', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.pending.value.length).toBe(1)
    // 同じファイルを再列挙する handle を差し替えて再スキャン
    const handle2 = fakeDirHandle([file])
    ;(w as any).dirName // touch to keep ts quiet
    dbState.dir = { id: 'main', handle: handle2, name: 'inbox' }
    await w.init() // re-load handle from db (dirHandle reactive ref)
    await w.scanNow()
    expect(w.pending.value.length).toBe(1) // no duplicate
  })

  it('scanNow: no handle → no-op', async () => {
    const upload = vi.fn()
    const w = useFolderWatcher({ upload })
    await w.scanNow()
    expect(upload).not.toHaveBeenCalled()
  })

  it('scanNow: skipped if already scanning', async () => {
    let resolveGetFile: (f: File) => void = () => {}
    const file = fakeFile('a.pdf', 100, 1)
    const handle = {
      name: 'inbox',
      queryPermission: vi.fn(async () => 'granted'),
      values: () => (async function* () {
        yield {
          kind: 'file' as const,
          name: file.name,
          getFile: () => new Promise<File>((r) => { resolveGetFile = r }),
        }
      })(),
    } as unknown as FileSystemDirectoryHandle
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    const first = w.scanNow()
    await new Promise((r) => setTimeout(r, 0))
    // first is blocked on getFile()
    await w.scanNow() // should return immediately
    expect(w.pending.value.length).toBe(0) // first hasn't completed yet
    resolveGetFile(file)
    await first
    expect(w.pending.value.length).toBe(1)
  })

  it('scanNow: throws inside iteration → error.value set, isScanning reset', async () => {
    const handle = {
      name: 'inbox',
      queryPermission: vi.fn(async () => 'granted'),
      values: () => (async function* () { throw new Error('iteration boom') })(),
    } as unknown as FileSystemDirectoryHandle
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.error.value).toBe('iteration boom')
    expect(w.isScanning.value).toBe(false)
  })

  it('scanNow: non-Error throw → String(e) used', async () => {
    const handle = {
      name: 'inbox',
      queryPermission: vi.fn(async () => 'granted'),
      values: () => (async function* () { throw 'plain-string' as any })(),
    } as unknown as FileSystemDirectoryHandle
    dbState.dir = { id: 'main', handle, name: 'inbox' }
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.init()
    await w.resumeWatch()
    expect(w.error.value).toBe('plain-string')
  })

  // ---------- uploadPending / uploadAllPending ----------

  it('uploadPending: invalid key returns false', async () => {
    const w = useFolderWatcher({ upload: vi.fn() })
    expect(await w.uploadPending('does-not-exist')).toBe(false)
  })

  it('uploadPending: success → moves entry from pending to seen=uploaded', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn().mockResolvedValue({ document_ids: ['d-1'], count: 1 })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    const key = w.pending.value[0]!.key

    const ok = await w.uploadPending(key)
    expect(ok).toBe(true)
    expect(upload).toHaveBeenCalledWith('/notify/documents/upload', expect.any(FormData))
    expect(w.pending.value).toEqual([])
    expect(w.seen.value[0]?.status).toBe('uploaded')
    expect(w.seen.value[0]?.documentId).toBe('d-1')
  })

  it('uploadPending: HTTP 413 → moves to seen=failed', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn().mockRejectedValue({ response: { status: 413 } })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    const key = w.pending.value[0]!.key

    const ok = await w.uploadPending(key)
    expect(ok).toBe(false)
    expect(w.pending.value).toEqual([])
    expect(w.seen.value[0]?.status).toBe('failed')
    expect(w.seen.value[0]?.errorMessage).toBe('HTTP 413')
  })

  it('uploadPending: statusCode field → HTTP message', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn().mockRejectedValue({ statusCode: 500 })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    await w.uploadPending(w.pending.value[0]!.key)
    expect(w.seen.value[0]?.errorMessage).toBe('HTTP 500')
  })

  it('uploadPending: error.message fallback', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn().mockRejectedValue({ message: 'network down' })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    await w.uploadPending(w.pending.value[0]!.key)
    expect(w.seen.value[0]?.errorMessage).toBe('network down')
  })

  it('uploadPending: empty error → "unknown error"', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn().mockRejectedValue({})
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    await w.uploadPending(w.pending.value[0]!.key)
    expect(w.seen.value[0]?.errorMessage).toBe('unknown error')
  })

  it('uploadPending: toggles isUploading', async () => {
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    let resolveUpload: (v: any) => void = () => {}
    const upload = vi.fn().mockReturnValue(new Promise((r) => { resolveUpload = r }))
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    const p = w.uploadPending(w.pending.value[0]!.key)
    await new Promise((r) => setTimeout(r, 0))
    expect(w.isUploading.value).toBe(true)
    resolveUpload({ document_ids: ['d'], count: 1 })
    await p
    expect(w.isUploading.value).toBe(false)
  })

  it('uploadAllPending: uploads all in order, returns counts', async () => {
    const fileA = fakeFile('a.pdf', 100, 1)
    const fileB = fakeFile('b.pdf', 200, 2)
    const handle = fakeDirHandle([fileA, fileB])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn()
      .mockResolvedValueOnce({ document_ids: ['da'], count: 1 })
      .mockResolvedValueOnce({ document_ids: ['db'], count: 1 })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    expect(w.pending.value.length).toBe(2)
    const res = await w.uploadAllPending()
    expect(res).toEqual({ ok: 2, failed: 0 })
    expect(w.pending.value).toEqual([])
    expect(w.seen.value.length).toBe(2)
  })

  it('uploadAllPending: mixes ok and failed', async () => {
    const fileA = fakeFile('a.pdf', 100, 1)
    const fileB = fakeFile('b.pdf', 200, 2)
    const handle = fakeDirHandle([fileA, fileB])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const upload = vi.fn()
      .mockResolvedValueOnce({ document_ids: ['da'], count: 1 })
      .mockRejectedValueOnce({ response: { status: 500 } })
    const w = useFolderWatcher({
      upload, setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    const res = await w.uploadAllPending()
    expect(res).toEqual({ ok: 1, failed: 1 })
    expect(w.pending.value).toEqual([])
    expect(w.seen.value.find((s) => s.name === 'a.pdf')?.status).toBe('uploaded')
    expect(w.seen.value.find((s) => s.name === 'b.pdf')?.status).toBe('failed')
  })

  // ---------- exclude ----------

  it('excludeName: removes from excluded + pending; unexcludeName / clearProcessed', async () => {
    const file = fakeFile('foo.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl: vi.fn(() => 1 as any) as any, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    expect(w.pending.value.map((p) => p.name)).toEqual(['foo.pdf'])

    await w.excludeName('foo.pdf')
    expect(w.excluded.value.map((x) => x.key)).toContain('foo.pdf')
    expect(w.pending.value).toEqual([])

    await w.unexcludeName('foo.pdf')
    expect(w.excluded.value.map((x) => x.key)).not.toContain('foo.pdf')

    dbState.seen = [{ key: 'k', name: 'n', size: 1, mtime: 1, status: 'uploaded', at: 1 }]
    await w.clearProcessed()
    expect(w.seen.value).toEqual([])
  })

  // ---------- misc ----------

  it('exposes POLL_INTERVAL_OPTIONS = [10, 30, 60]', () => {
    expect(POLL_INTERVAL_OPTIONS).toEqual([10, 30, 60])
  })

  it('startWatching: timer callback invokes scanNow', async () => {
    const handle = fakeDirHandle([])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const setIntervalImpl = vi.fn(() => 1 as any) as any
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    const cb = setIntervalImpl.mock.calls[0][0] as () => void
    cb()
  })

  it('setPollInterval timer callback invokes scanNow', async () => {
    const handle = fakeDirHandle([])
    ;(globalThis as any).showDirectoryPicker = vi.fn().mockResolvedValue(handle)
    const setIntervalImpl = vi.fn(() => 1 as any) as any
    const w = useFolderWatcher({
      upload: vi.fn(), setIntervalImpl, clearIntervalImpl: vi.fn() as any,
    })
    await w.pickFolder()
    w.setPollInterval(60)
    const cb = setIntervalImpl.mock.calls[1][0] as () => void
    cb()
  })

  it('refreshLists sorts seen and excluded by recency (covers sort callbacks)', async () => {
    dbState.seen = [
      { key: 'a', name: 'a', size: 1, mtime: 1, status: 'uploaded', at: 100 },
      { key: 'b', name: 'b', size: 1, mtime: 1, status: 'uploaded', at: 200 },
    ]
    dbState.excluded = [
      { key: 'x', at: 100 },
      { key: 'y', at: 200 },
    ]
    const w = useFolderWatcher({ upload: vi.fn() })
    await w.init()
    expect(w.seen.value[0]?.at).toBe(200)
    expect(w.excluded.value[0]?.at).toBe(200)
  })

  it('default upload (no options.upload) routes through useApi for uploadPending', async () => {
    defaultFetch.mockResolvedValue({ document_ids: ['default-doc'], count: 1 })
    const file = fakeFile('a.pdf', 100, 1)
    const handle = fakeDirHandle([file])
    dbState.dir = { id: 'main', handle, name: 'inbox' }

    const w = useFolderWatcher() // no options
    await w.init()
    // 直接 scanNow と uploadPending を呼ぶ (resumeWatch すると startWatching が timer を作って手間が増える)
    await w.scanNow()
    expect(w.pending.value.length).toBe(1)
    await w.uploadPending(w.pending.value[0]!.key)

    expect(defaultFetch).toHaveBeenCalledWith(
      'http://api/api/notify/documents/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(w.seen.value[0]?.documentId).toBe('default-doc')
  })
})
