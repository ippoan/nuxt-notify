import { describe, it, expect } from 'vitest'
import {
  POLL_MAX_DURATION_MS,
  POLL_MAX_FAILURES,
  becameCompleted,
  inProgressIds,
  isInProgress,
  keepPolling,
  processingIds,
  shouldPollDocument,
} from '../../app/utils/processingPoll'

describe('isInProgress / shouldPollDocument', () => {
  it('pending と processing だけが処理中', () => {
    expect(isInProgress('pending')).toBe(true)
    expect(isInProgress('processing')).toBe(true)
    for (const s of ['completed', 'failed', 'skipped', undefined, null]) {
      expect(isInProgress(s)).toBe(false)
    }
  })

  it('詳細画面: マスクか抽出のどちらかが処理中なら追う (WS が来なくても終わりまで)', () => {
    expect(shouldPollDocument('processing', 'completed')).toBe(true)
    expect(shouldPollDocument('completed', 'pending')).toBe(true)
    expect(shouldPollDocument('completed', 'completed')).toBe(false)
    expect(shouldPollDocument('failed', 'failed')).toBe(false)
    expect(shouldPollDocument('skipped', undefined)).toBe(false)
  })
})

describe('becameCompleted', () => {
  it('completed に変わった瞬間だけ true (プレビューの読み直しを 1 回にする)', () => {
    expect(becameCompleted('processing', 'completed')).toBe(true)
    expect(becameCompleted('pending', 'completed')).toBe(true)
    expect(becameCompleted(undefined, 'completed')).toBe(true)
    expect(becameCompleted('completed', 'completed')).toBe(false)
    expect(becameCompleted('processing', 'failed')).toBe(false)
  })
})

describe('inProgressIds / processingIds', () => {
  const docs = [
    { id: 'a', redaction_status: 'processing', extraction_status: 'completed' },
    { id: 'b', redaction_status: 'completed', extraction_status: 'pending' },
    { id: 'c', redaction_status: 'completed', extraction_status: 'completed' },
    { id: 'd', redaction_status: 'failed', extraction_status: 'failed' },
    { id: 'e', redaction_status: 'pending', extraction_status: 'pending' },
  ]

  it('追いかけている文書のうち、まだ処理中のものだけを残す', () => {
    expect([...inProgressIds(docs, ['a', 'b', 'c', 'd'])].sort()).toEqual(['a', 'b'])
  })

  it('一覧から消えた文書は追わない', () => {
    expect([...inProgressIds(docs, ['a', 'gone'])]).toEqual(['a'])
  })

  it('一覧を開いたときは、マスクが processing の文書だけを追い始める (pending の放置分は追わない)', () => {
    expect([...processingIds(docs)]).toEqual(['a'])
  })
})

describe('keepPolling', () => {
  const t0 = 1_000_000

  it('失敗が続いても上限までは続け、上限で止める', () => {
    expect(keepPolling(0, t0, t0 + 5000)).toBe(true)
    expect(keepPolling(POLL_MAX_FAILURES - 1, t0, t0 + 5000)).toBe(true)
    expect(keepPolling(POLL_MAX_FAILURES, t0, t0 + 5000)).toBe(false)
  })

  it('追いかける長さの上限を超えたら止める', () => {
    expect(keepPolling(0, t0, t0 + POLL_MAX_DURATION_MS - 1)).toBe(true)
    expect(keepPolling(0, t0, t0 + POLL_MAX_DURATION_MS)).toBe(false)
  })
})
