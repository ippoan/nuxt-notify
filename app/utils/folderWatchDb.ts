/**
 * フォルダ監視用 IndexedDB ラッパー。
 *
 * - directories: 監視対象フォルダの handle (singleton, id='main')
 * - seen:        処理済み (アップロード成功 or 失敗) のファイル。key = `${name}|${size}|${mtime}`
 * - excluded:    ユーザーが除外したファイル名。key = filename (name-only マッチ)
 */

const DB_NAME = 'nuxt-notify-watch'
const DB_VERSION = 1

export type SeenStatus = 'uploaded' | 'failed'

export interface DirRow {
  id: 'main'
  handle: FileSystemDirectoryHandle
  name: string
}

export interface SeenRow {
  key: string
  name: string
  size: number
  mtime: number
  status: SeenStatus
  at: number
  documentId?: string
  errorMessage?: string
}

export interface ExcludedRow {
  key: string // filename
  at: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('directories', { keyPath: 'id' })
      db.createObjectStore('seen', { keyPath: 'key' })
      db.createObjectStore('excluded', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    /* v8 ignore start */
    req.onerror = () => reject(req.error)
    /* v8 ignore stop */
  })
}

function tx<T>(
  store: 'directories' | 'seen' | 'excluded',
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        transaction.oncomplete = () => db.close()
        const result = fn(transaction.objectStore(store))
        result.onsuccess = () => resolve(result.result)
        /* v8 ignore start */
        result.onerror = () => reject(result.error)
        /* v8 ignore stop */
      }),
  )
}

export const folderWatchDb = {
  async getDir(): Promise<DirRow | null> {
    const row = await tx<DirRow | undefined>('directories', 'readonly', (s) => s.get('main'))
    return row ?? null
  },

  async setDir(handle: FileSystemDirectoryHandle, name: string): Promise<void> {
    await tx('directories', 'readwrite', (s) => s.put({ id: 'main', handle, name } as DirRow))
  },

  async clearDir(): Promise<void> {
    await tx('directories', 'readwrite', (s) => s.delete('main'))
  },

  async listSeen(): Promise<SeenRow[]> {
    return await tx<SeenRow[]>('seen', 'readonly', (s) => s.getAll() as IDBRequest<SeenRow[]>)
  },

  async addSeen(row: SeenRow): Promise<void> {
    await tx('seen', 'readwrite', (s) => s.put(row))
  },

  async hasSeenKey(key: string): Promise<boolean> {
    const v = await tx<SeenRow | undefined>('seen', 'readonly', (s) => s.get(key))
    return v !== undefined
  },

  async listExcluded(): Promise<ExcludedRow[]> {
    return await tx<ExcludedRow[]>(
      'excluded',
      'readonly',
      (s) => s.getAll() as IDBRequest<ExcludedRow[]>,
    )
  },

  async addExcluded(name: string): Promise<void> {
    await tx('excluded', 'readwrite', (s) => s.put({ key: name, at: Date.now() } as ExcludedRow))
  },

  async removeExcluded(name: string): Promise<void> {
    await tx('excluded', 'readwrite', (s) => s.delete(name))
  },

  async isExcluded(name: string): Promise<boolean> {
    const v = await tx<ExcludedRow | undefined>('excluded', 'readonly', (s) => s.get(name))
    return v !== undefined
  },

  async clearProcessed(): Promise<void> {
    await tx('seen', 'readwrite', (s) => s.clear())
    await tx('excluded', 'readwrite', (s) => s.clear())
  },
}

/** テスト専用: 内部 DB 名 (削除用) */
export const _DB_NAME_FOR_TEST = DB_NAME
