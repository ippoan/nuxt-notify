import { describe, it, expect } from 'vitest'
import {
  extractionBadge,
  distributionBadge,
  redactionBadge,
  deliveryStatusLabel,
  formatSize,
  formatDate,
} from '../../app/utils/documentBadges'

describe('extractionBadge', () => {
  it('既知ステータス', () => {
    expect(extractionBadge('completed').label).toBe('抽出済')
    expect(extractionBadge('failed').label).toBe('抽出失敗')
    expect(extractionBadge('pending').label).toBe('抽出待ち')
  })
  it('未知ステータスは raw label', () => {
    const b = extractionBadge('weird')
    expect(b.label).toBe('weird')
    expect(b.cls).toContain('gray')
  })
})

describe('distributionBadge', () => {
  it('既知ステータス', () => {
    expect(distributionBadge('completed').label).toBe('配信済')
    expect(distributionBadge('in_progress').label).toBe('配信中')
    expect(distributionBadge('failed').label).toBe('配信失敗')
  })
  it('未知ステータスは未配信', () => {
    expect(distributionBadge('xyz').label).toBe('未配信')
  })
})

describe('redactionBadge', () => {
  it('completed: 件数あり / なし', () => {
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'completed', redactions_applied: 3 })!.label)
      .toBe('🔒 3箇所')
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'completed', redactions_applied: null })!.label)
      .toBe('🔒 マスク済')
  })
  it('processing / failed', () => {
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'processing' })!.label).toBe('🔄 マスク処理中')
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'failed' })!.label).toBe('⚠️ マスク失敗')
  })
  it('pending: PDF はマスク待ち / 非PDF は null', () => {
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'pending' })!.label).toBe('マスク待ち')
    expect(redactionBadge({ file_name: 'a.png', redaction_status: 'pending' })).toBeNull()
  })
  it('skipped は常に null', () => {
    expect(redactionBadge({ file_name: 'a.pdf', redaction_status: 'skipped' })).toBeNull()
  })
  it('undefined (未デプロイ): PDF はマスク待ち / 非PDF は null', () => {
    expect(redactionBadge({ file_name: 'a.pdf' })!.label).toBe('マスク待ち')
    expect(redactionBadge({ file_name: 'a.docx' })).toBeNull()
  })
  it('file_name null は非PDF扱いで null', () => {
    expect(redactionBadge({ file_name: null, redaction_status: 'pending' })).toBeNull()
  })
})

describe('deliveryStatusLabel', () => {
  it('既知ステータス', () => {
    expect(deliveryStatusLabel('sent').label).toBe('送信済')
    expect(deliveryStatusLabel('failed').label).toBe('失敗')
    expect(deliveryStatusLabel('pending').label).toBe('未送信')
  })
  it('未知ステータスは raw label', () => {
    expect(deliveryStatusLabel('queued').label).toBe('queued')
  })
})

describe('formatSize', () => {
  it('0 / null は -', () => {
    expect(formatSize(null)).toBe('-')
    expect(formatSize(0)).toBe('-')
  })
  it('B / KB / MB', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('formatDate', () => {
  it('null は -', () => {
    expect(formatDate(null)).toBe('-')
  })
  it('ISO 文字列をローカル整形 (年が含まれる)', () => {
    const out = formatDate('2026-05-08T14:51:00Z')
    expect(out).not.toBe('-')
    expect(out).toContain('2026')
  })
})
