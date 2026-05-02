import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'

const { folderWatchDb, _DB_NAME_FOR_TEST } = await import('../../app/utils/folderWatchDb')

const fakeHandle = (name: string): FileSystemDirectoryHandle =>
  ({ name, kind: 'directory' }) as unknown as FileSystemDirectoryHandle

function resetDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(_DB_NAME_FOR_TEST)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await resetDb()
})

describe('folderWatchDb', () => {
  describe('directories', () => {
    it('returns null when no directory saved', async () => {
      expect(await folderWatchDb.getDir()).toBeNull()
    })

    it('saves and reads back a directory handle', async () => {
      await folderWatchDb.setDir(fakeHandle('inbox'), 'inbox')
      const row = await folderWatchDb.getDir()
      expect(row?.id).toBe('main')
      expect(row?.name).toBe('inbox')
    })

    it('overwrites existing directory on setDir', async () => {
      await folderWatchDb.setDir(fakeHandle('a'), 'a')
      await folderWatchDb.setDir(fakeHandle('b'), 'b')
      expect((await folderWatchDb.getDir())?.name).toBe('b')
    })

    it('clears the directory', async () => {
      await folderWatchDb.setDir(fakeHandle('inbox'), 'inbox')
      await folderWatchDb.clearDir()
      expect(await folderWatchDb.getDir()).toBeNull()
    })
  })

  describe('seen', () => {
    it('starts empty', async () => {
      expect(await folderWatchDb.listSeen()).toEqual([])
      expect(await folderWatchDb.hasSeenKey('any')).toBe(false)
    })

    it('adds and lists seen rows, hasSeenKey returns true', async () => {
      await folderWatchDb.addSeen({
        key: 'a.pdf|10|1', name: 'a.pdf', size: 10, mtime: 1,
        status: 'uploaded', at: 100, documentId: 'doc-1',
      })
      const rows = await folderWatchDb.listSeen()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.documentId).toBe('doc-1')
      expect(await folderWatchDb.hasSeenKey('a.pdf|10|1')).toBe(true)
    })

    it('addSeen on same key replaces (put semantics)', async () => {
      const base = { key: 'k', name: 'n', size: 1, mtime: 2, status: 'failed' as const, at: 1 }
      await folderWatchDb.addSeen({ ...base, errorMessage: 'first' })
      await folderWatchDb.addSeen({ ...base, status: 'uploaded', at: 2 })
      const rows = await folderWatchDb.listSeen()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('uploaded')
    })
  })

  describe('excluded', () => {
    it('starts empty and isExcluded false', async () => {
      expect(await folderWatchDb.listExcluded()).toEqual([])
      expect(await folderWatchDb.isExcluded('foo.pdf')).toBe(false)
    })

    it('addExcluded then isExcluded returns true', async () => {
      await folderWatchDb.addExcluded('foo.pdf')
      expect(await folderWatchDb.isExcluded('foo.pdf')).toBe(true)
      const list = await folderWatchDb.listExcluded()
      expect(list).toHaveLength(1)
      expect(list[0]?.key).toBe('foo.pdf')
    })

    it('removeExcluded removes the entry', async () => {
      await folderWatchDb.addExcluded('foo.pdf')
      await folderWatchDb.removeExcluded('foo.pdf')
      expect(await folderWatchDb.isExcluded('foo.pdf')).toBe(false)
    })
  })

  describe('clearProcessed', () => {
    it('clears both seen and excluded', async () => {
      await folderWatchDb.addSeen({
        key: 'k', name: 'n', size: 1, mtime: 1, status: 'uploaded', at: 1,
      })
      await folderWatchDb.addExcluded('foo.pdf')
      await folderWatchDb.clearProcessed()
      expect(await folderWatchDb.listSeen()).toEqual([])
      expect(await folderWatchDb.listExcluded()).toEqual([])
    })
  })

  describe('schema upgrade', () => {
    it('creates all three stores on first open', async () => {
      // Force a fresh open by calling each store
      await folderWatchDb.listSeen()
      await folderWatchDb.listExcluded()
      expect(await folderWatchDb.getDir()).toBeNull()
    })
  })
})
