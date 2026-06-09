import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getHiddenIds,
  isHidden,
  hideDocument,
  unhideDocument,
} from '../../app/utils/hiddenDocuments'

const KEY = 'notify:hidden-documents'

/** in-memory localStorage stub。getItem/setItem を任意に差し替え可能。 */
function makeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  return {
    store,
    impl: {
      getItem: (k: string): string | null => (k in store ? store[k]! : null),
      setItem: (k: string, v: string): void => {
        store[k] = v
      },
      removeItem: (k: string): void => {
        delete store[k]
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hiddenDocuments', () => {
  it('localStorage 非対応環境では空集合 / no-op にフォールバックする', () => {
    // node test env では localStorage が undefined。stub しない。
    expect(getHiddenIds().size).toBe(0)
    expect(isHidden('a')).toBe(false)
    // write 側も typeof undefined を通過して例外を投げない
    expect(hideDocument('a').has('a')).toBe(true)
    expect(unhideDocument('a').has('a')).toBe(false)
  })

  it('hide → getHiddenIds / isHidden で永続化される', () => {
    const { store, impl } = makeStorage()
    vi.stubGlobal('localStorage', impl)

    expect(getHiddenIds().size).toBe(0)
    const after = hideDocument('doc-1')
    expect(after.has('doc-1')).toBe(true)
    expect(JSON.parse(store[KEY]!)).toEqual(['doc-1'])
    expect(isHidden('doc-1')).toBe(true)
    expect(isHidden('doc-2')).toBe(false)
  })

  it('unhide で集合から取り除かれる', () => {
    const { store, impl } = makeStorage({ [KEY]: JSON.stringify(['a', 'b']) })
    vi.stubGlobal('localStorage', impl)

    const after = unhideDocument('a')
    expect(after.has('a')).toBe(false)
    expect(after.has('b')).toBe(true)
    expect(JSON.parse(store[KEY]!)).toEqual(['b'])
  })

  it('空文字 / 未保存キーは空集合', () => {
    const { impl } = makeStorage({ [KEY]: '' })
    vi.stubGlobal('localStorage', impl)
    expect(getHiddenIds().size).toBe(0)
  })

  it('配列でない JSON は空集合扱い', () => {
    const { impl } = makeStorage({ [KEY]: JSON.stringify({ not: 'array' }) })
    vi.stubGlobal('localStorage', impl)
    expect(getHiddenIds().size).toBe(0)
  })

  it('配列内の非文字列要素は除外される', () => {
    const { impl } = makeStorage({ [KEY]: JSON.stringify(['ok', 123, null, 'ok2']) })
    vi.stubGlobal('localStorage', impl)
    expect([...getHiddenIds()].sort()).toEqual(['ok', 'ok2'])
  })

  it('壊れた JSON は catch して空集合', () => {
    const { impl } = makeStorage({ [KEY]: '{not valid json' })
    vi.stubGlobal('localStorage', impl)
    expect(getHiddenIds().size).toBe(0)
  })

  it('setItem が例外を投げても hide/unhide は throw しない', () => {
    const throwing = {
      getItem: () => JSON.stringify(['x']),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    vi.stubGlobal('localStorage', throwing)
    // 例外を握りつぶして集合は返る
    expect(() => hideDocument('y')).not.toThrow()
    expect(hideDocument('y').has('y')).toBe(true)
    expect(() => unhideDocument('x')).not.toThrow()
  })
})
