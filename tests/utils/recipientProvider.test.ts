import { describe, it, expect } from 'vitest'
import {
  providerLabel,
  providerClass,
  isRecipientFormValid,
  providerIds,
  distributableRecipients,
  recipientErrorMessage,
  type ProviderFormValues,
} from '../../app/utils/recipientProvider'

const base: ProviderFormValues = {
  name: '山田',
  provider: 'line',
  line_user_id: '',
  lineworks_user_id: '',
  email: '',
}

describe('providerLabel / providerClass', () => {
  it('3 分岐', () => {
    expect(providerLabel('line')).toBe('LINE')
    expect(providerLabel('lineworks')).toBe('LINE WORKS')
    expect(providerLabel('email')).toBe('メール')
    expect(providerClass('line')).toBe('text-green-600')
    expect(providerClass('lineworks')).toBe('text-blue-600')
    expect(providerClass('email')).toBe('text-amber-600')
  })
})

describe('isRecipientFormValid', () => {
  it('名前が空なら常に不可', () => {
    expect(isRecipientFormValid({ ...base, name: ' ', line_user_id: 'U1' })).toBe(false)
  })
  it('line は LINE User ID が必須', () => {
    expect(isRecipientFormValid(base)).toBe(false)
    expect(isRecipientFormValid({ ...base, line_user_id: 'U1' })).toBe(true)
  })
  it('lineworks は LINE WORKS User ID が必須', () => {
    const f = { ...base, provider: 'lineworks' as const }
    expect(isRecipientFormValid(f)).toBe(false)
    expect(isRecipientFormValid({ ...f, lineworks_user_id: 'w1' })).toBe(true)
  })
  it('email はメールが必須 (ID は不要)', () => {
    const f = { ...base, provider: 'email' as const }
    expect(isRecipientFormValid(f)).toBe(false)
    expect(isRecipientFormValid({ ...f, email: 'a@example.com' })).toBe(true)
  })
})

describe('providerIds', () => {
  it('provider に合う ID だけ送る', () => {
    const f = { ...base, line_user_id: ' U1 ', lineworks_user_id: 'w1' }
    expect(providerIds(f)).toEqual({ line_user_id: 'U1', lineworks_user_id: null })
    expect(providerIds({ ...f, provider: 'lineworks' })).toEqual({ line_user_id: null, lineworks_user_id: 'w1' })
    expect(providerIds({ ...f, provider: 'email' })).toEqual({ line_user_id: null, lineworks_user_id: null })
  })
  it('空白だけは null', () => {
    expect(providerIds({ ...base, line_user_id: ' ' }).line_user_id).toBeNull()
    expect(providerIds({ ...base, provider: 'lineworks', lineworks_user_id: ' ' }).lineworks_user_id).toBeNull()
  })
})

describe('distributableRecipients', () => {
  it('有効で email 以外だけ残す', () => {
    const rs = [
      { id: 1, provider: 'line' as const, enabled: true },
      { id: 2, provider: 'lineworks' as const, enabled: true },
      { id: 3, provider: 'email' as const, enabled: true },
      { id: 4, provider: 'line' as const, enabled: false },
    ]
    expect(distributableRecipients(rs).map((r) => r.id)).toEqual([1, 2])
  })
})

describe('recipientErrorMessage', () => {
  it('Worker の error 語を日本語にする', () => {
    expect(recipientErrorMessage({ data: { error: 'line_user_id_required' } })).toBe('LINE User ID を入れてください')
    expect(recipientErrorMessage({ data: { error: 'lineworks_user_id_required' } })).toBe('LINE WORKS User ID を入れてください')
    expect(recipientErrorMessage({ response: { _data: { error: 'email_required' } } })).toBe('メールアドレスを入れてください')
    expect(recipientErrorMessage({ data: { error: 'invalid_provider' } })).toBe('プロバイダが正しくありません')
  })
  it('知らない語・形は null', () => {
    expect(recipientErrorMessage({ data: { error: 'boom' } })).toBeNull()
    expect(recipientErrorMessage({ data: { error: 'toString' } })).toBeNull()
    expect(recipientErrorMessage({ data: { error: 5 } })).toBeNull()
    expect(recipientErrorMessage(new Error('x'))).toBeNull()
    expect(recipientErrorMessage(undefined)).toBeNull()
  })
})
