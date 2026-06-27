import { describe, it, expect } from 'vitest'
import {
  attachmentDisposition,
  guessContentType,
  inlineDisposition,
  isExpired,
  isRedactedJpeg,
  isSafeInline,
  parseRegisterBody,
  readKey,
  readKeyPrefix,
  timingSafeEqual,
  toMetadata,
  viewKey,
  viewTtlSeconds,
  type ViewRecord,
} from '../../server/utils/notify-view'

const sample = (): ViewRecord => ({
  r2_key: 'tenant/email/msg/file.pdf',
  tenant_id: 'tn-1',
  document_id: 'doc-1',
  recipient_id: 'rcp-1',
  file_name: 'file.pdf',
  file_size_bytes: 2048,
  source_subject: '件名',
  source_sender: 'from@example.com',
  source_received_at: '2026-06-27T00:00:00.000Z',
  expire_at: '2026-07-04T00:00:00.000Z',
})

describe('keys', () => {
  it('viewKey / readKey / readKeyPrefix', () => {
    expect(viewKey('abc')).toBe('view:abc')
    expect(readKey('tn-1', 'doc-1', 'rcp-1')).toBe('read:tn-1:doc-1:rcp-1')
    expect(readKeyPrefix('tn-1', 'doc-1')).toBe('read:tn-1:doc-1:')
  })
})

describe('parseRegisterBody', () => {
  it('完全な body を ViewRecord にする', () => {
    const rec = parseRegisterBody({ token: 't', ...sample() })
    expect(rec).not.toBeNull()
    expect(rec!.r2_key).toBe('tenant/email/msg/file.pdf')
    expect(rec!.tenant_id).toBe('tn-1')
    expect(rec!.file_size_bytes).toBe(2048)
  })

  it('必須欠落は null', () => {
    expect(parseRegisterBody(null)).toBeNull()
    expect(parseRegisterBody('x')).toBeNull()
    expect(parseRegisterBody({})).toBeNull()
    expect(parseRegisterBody({ r2_key: 'k', tenant_id: 't', document_id: 'd', recipient_id: 'r' })).toBeNull() // expire_at 欠落
    expect(parseRegisterBody({ r2_key: 'k', document_id: 'd', recipient_id: 'r', expire_at: 'e' })).toBeNull() // tenant_id 欠落
    expect(parseRegisterBody({ r2_key: '', tenant_id: 't', document_id: 'd', recipient_id: 'r', expire_at: 'e' })).toBeNull() // 空文字
  })

  it('optional は型不一致なら null フィールドに落とす', () => {
    const rec = parseRegisterBody({
      r2_key: 'k',
      tenant_id: 't',
      document_id: 'd',
      recipient_id: 'r',
      expire_at: 'e',
      file_name: 123,
      file_size_bytes: 'x',
      source_subject: null,
      source_sender: undefined,
      source_received_at: 5,
    })
    expect(rec).not.toBeNull()
    expect(rec!.file_name).toBeNull()
    expect(rec!.file_size_bytes).toBeNull()
    expect(rec!.source_subject).toBeNull()
    expect(rec!.source_sender).toBeNull()
    expect(rec!.source_received_at).toBeNull()
  })
})

describe('toMetadata', () => {
  it('r2_key / 内部 id を落とす', () => {
    const m = toMetadata(sample())
    const json = JSON.stringify(m)
    expect(json).not.toContain('r2_key')
    expect(json).not.toContain('document_id')
    expect(json).not.toContain('recipient_id')
    expect(m.file_name).toBe('file.pdf')
    expect(m.expire_at).toBe('2026-07-04T00:00:00.000Z')
  })
})

describe('isExpired', () => {
  const now = Date.parse('2026-06-27T00:00:00.000Z')
  it('未来は false', () => {
    expect(isExpired('2026-06-28T00:00:00.000Z', now)).toBe(false)
  })
  it('同時刻・過去は true', () => {
    expect(isExpired('2026-06-27T00:00:00.000Z', now)).toBe(true)
    expect(isExpired('2026-06-26T00:00:00.000Z', now)).toBe(true)
  })
  it('parse 不能は失効扱い (true)', () => {
    expect(isExpired('not-a-date', now)).toBe(true)
  })
})

describe('viewTtlSeconds', () => {
  const now = Date.parse('2026-06-27T00:00:00.000Z')
  it('残り秒を返す', () => {
    expect(viewTtlSeconds('2026-06-27T01:00:00.000Z', now)).toBe(3600)
  })
  it('60s 未満は 60 に切り上げ', () => {
    expect(viewTtlSeconds('2026-06-27T00:00:30.000Z', now)).toBe(60)
    expect(viewTtlSeconds('2026-06-26T00:00:00.000Z', now)).toBe(60) // 過去
  })
  it('parse 不能は 60', () => {
    expect(viewTtlSeconds('bad', now)).toBe(60)
  })
})

describe('guessContentType', () => {
  it('拡張子別', () => {
    expect(guessContentType('a.pdf')).toBe('application/pdf')
    expect(guessContentType('A.PDF')).toBe('application/pdf')
    expect(guessContentType('a.png')).toBe('image/png')
    expect(guessContentType('a.jpg')).toBe('image/jpeg')
    expect(guessContentType('a.jpeg')).toBe('image/jpeg')
    expect(guessContentType('a.gif')).toBe('image/gif')
    expect(guessContentType('a.webp')).toBe('image/webp')
    // svg は同一オリジン XSS 回避のため octet-stream に倒す
    expect(guessContentType('a.svg')).toBe('application/octet-stream')
    expect(guessContentType('note.txt')).toBe('text/plain; charset=utf-8')
  })
  it('不明 / null は application/pdf', () => {
    expect(guessContentType('a.xlsx')).toBe('application/pdf')
    expect(guessContentType('noext')).toBe('application/pdf')
    expect(guessContentType(null)).toBe('application/pdf')
    expect(guessContentType(undefined)).toBe('application/pdf')
  })
})

describe('isRedactedJpeg', () => {
  it('.jpg/.jpeg は true、他は false', () => {
    expect(isRedactedJpeg('a/b.jpg')).toBe(true)
    expect(isRedactedJpeg('a/b.JPEG')).toBe(true)
    expect(isRedactedJpeg('a/b.pdf')).toBe(false)
  })
})

describe('isSafeInline', () => {
  it('pdf/png/jpeg/gif/webp は inline 可', () => {
    for (const ct of ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isSafeInline(ct)).toBe(true)
    }
  })
  it('svg/html/octet-stream/text は inline 不可 (XSS 回避)', () => {
    for (const ct of ['image/svg+xml', 'text/html', 'application/octet-stream', 'text/plain; charset=utf-8']) {
      expect(isSafeInline(ct)).toBe(false)
    }
  })
})

describe('attachmentDisposition', () => {
  it('attachment + RFC5987', () => {
    const cd = attachmentDisposition('点呼.pdf')
    expect(cd.startsWith('attachment; ')).toBe(true)
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).toContain('%E7%82%B9%E5%91%BC.pdf')
  })
  it('null はデフォルト名', () => {
    expect(attachmentDisposition(null)).toContain('filename="download"')
  })
})

describe('inlineDisposition', () => {
  it('ASCII', () => {
    const cd = inlineDisposition('hello.pdf')
    expect(cd.startsWith('inline; ')).toBe(true)
    expect(cd).toContain('filename="hello.pdf"')
    expect(cd).toContain("filename*=UTF-8''hello.pdf")
  })
  it('UTF-8 は RFC5987 エンコード', () => {
    const cd = inlineDisposition('点呼.pdf')
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).toContain('%E7%82%B9%E5%91%BC.pdf')
  })
  it('ダブルクォートは _ に置換', () => {
    expect(inlineDisposition('a"b.pdf')).toContain('filename="a_b.pdf"')
  })
  it('null / 空はデフォルト名', () => {
    expect(inlineDisposition(null)).toContain('filename="attachment"')
    expect(inlineDisposition('')).toContain('filename="attachment"')
  })
})

describe('timingSafeEqual', () => {
  it('一致', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true)
  })
  it('不一致 (同長 / 異長)', () => {
    expect(timingSafeEqual('secret', 'secreT')).toBe(false)
    expect(timingSafeEqual('secret', 'secret-longer')).toBe(false)
    expect(timingSafeEqual('', 'x')).toBe(false)
  })
})
