import { describe, it, expect } from 'vitest'
import {
  extractionBadge,
  distributionBadge,
  redactionBadge,
  deliveryStatusLabel,
  formatSize,
  formatDate,
  extractPrefecture,
  buildLogisticsTitle,
  type DocumentCardData,
} from '../../app/utils/documentBadges'

/** buildLogisticsTitle に渡す最小の DocumentCardData を作る。 */
function docWith(logistics: Record<string, unknown> | null): DocumentCardData {
  return {
    id: 'x',
    file_name: '3387_001.pdf',
    created_at: '2026-05-09T00:00:00Z',
    extracted_data: logistics === null ? null : { logistics },
  }
}

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

describe('extractPrefecture', () => {
  it('先頭の都道府県を切り出す', () => {
    expect(extractPrefecture('熊本県八代市…')).toBe('熊本県')
    expect(extractPrefecture('東京都千代田区')).toBe('東京都')
    expect(extractPrefecture('京都府京都市')).toBe('京都府')
    expect(extractPrefecture('北海道札幌市')).toBe('北海道')
  })
  it('prefix ノイズがあっても拾う', () => {
    expect(extractPrefecture('〒861-0000 熊本県八代市')).toBe('熊本県')
  })
  it('複数県を含む場合は最も前方を採用', () => {
    expect(extractPrefecture('大阪府経由 東京都行き')).toBe('大阪府')
  })
  it('該当なし / 空 / null は null', () => {
    expect(extractPrefecture('どこか不明な場所')).toBeNull()
    expect(extractPrefecture('')).toBeNull()
    expect(extractPrefecture(null)).toBeNull()
    expect(extractPrefecture(undefined)).toBeNull()
  })
})

describe('buildLogisticsTitle', () => {
  it('日時 + 県ー日時 + 県　品名 を組み立てる', () => {
    const title = buildLogisticsTitle(
      docWith({
        loading_at: '11/10 08:00',
        loading_place: '北海道札幌市…',
        unloading_at: '11/11 14:00',
        unloading_place: '東京都港区…',
        cargo_name: '冷凍食品',
      }),
    )
    expect(title).toBe('11/10 08:00 北海道ー11/11 14:00 東京都　冷凍食品')
  })
  it('住所フィールド (place が無くても address) から県を拾う', () => {
    const title = buildLogisticsTitle(
      docWith({
        loading_at: '8:00',
        loading_place_address: '〒861 熊本県八代市',
        unloading_place_address: '大阪府大阪市',
      }),
    )
    expect(title).toBe('8:00 熊本県ー大阪府')
  })
  it('ISO 8601 の日時は MM/DD HH:mm に圧縮', () => {
    const title = buildLogisticsTitle(
      docWith({
        loading_at: '2026-11-10T08:00:00',
        loading_place: '愛知県名古屋市',
      }),
    )
    // ローカルタイムゾーン依存を避けるため県と区切りの存在だけ確認
    expect(title).toContain('愛知県')
    expect(title).toMatch(/^\d{2}\/\d{2}\s\d{2}:\d{2}\s愛知県$/)
  })
  it('正規表現にマッチするが無効な日付 (月13) はそのまま raw 文字列', () => {
    const title = buildLogisticsTitle(
      docWith({
        loading_at: '2026-13-40T08:00',
        loading_place: '愛知県名古屋市',
      }),
    )
    expect(title).toBe('2026-13-40T08:00 愛知県')
  })
  it('cargo_name (backend 未対応) が無くても route だけで組む', () => {
    const title = buildLogisticsTitle(
      docWith({
        loading_at: '08:00',
        loading_place: '福岡県',
        unloading_at: '18:00',
        unloading_place: '広島県',
      }),
    )
    expect(title).toBe('08:00 福岡県ー18:00 広島県')
  })
  it('logistics が空 / 県も日時も拾えなければ null', () => {
    expect(buildLogisticsTitle(docWith({}))).toBeNull()
    expect(buildLogisticsTitle(docWith({ notes: 'メモのみ' }))).toBeNull()
  })
  it('extracted_data が無い / logistics キーが無いと null', () => {
    expect(buildLogisticsTitle(docWith(null))).toBeNull()
    expect(
      buildLogisticsTitle({
        id: 'x',
        file_name: 'a.pdf',
        created_at: '2026-05-09T00:00:00Z',
        extracted_data: { summary: 'no logistics' },
      }),
    ).toBeNull()
  })
})
