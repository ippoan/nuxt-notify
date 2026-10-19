// 宛先 (notify_recipients) の provider ごとのロジック。
// 'email' は LINE / LINE WORKS の ID を持たない、メールだけの宛先 (アルコール検知メールの受け取り手)。

export type RecipientProvider = 'line' | 'lineworks' | 'email'

export interface ProviderFormValues {
  name: string
  provider: RecipientProvider
  line_user_id: string
  lineworks_user_id: string
  email: string
}

export interface ProviderRecipient {
  provider: RecipientProvider
  enabled: boolean
}

export function providerLabel(provider: RecipientProvider): string {
  switch (provider) {
    case 'line':
      return 'LINE'
    case 'lineworks':
      return 'LINE WORKS'
    default:
      return 'メール'
  }
}

export function providerClass(provider: RecipientProvider): string {
  switch (provider) {
    case 'line':
      return 'text-green-600'
    case 'lineworks':
      return 'text-blue-600'
    default:
      return 'text-amber-600'
  }
}

/** 登録できる状態か。名前はどれも必須、あとは provider ごとの必須。 */
export function isRecipientFormValid(form: ProviderFormValues): boolean {
  if (!form.name.trim()) return false
  switch (form.provider) {
    case 'line':
      return !!form.line_user_id.trim()
    case 'lineworks':
      return !!form.lineworks_user_id.trim()
    default:
      return !!form.email.trim()
  }
}

/** provider に合わない側の ID は null にして送る。 */
export function providerIds(form: ProviderFormValues): {
  line_user_id: string | null
  lineworks_user_id: string | null
} {
  return {
    line_user_id: form.provider === 'line' ? form.line_user_id.trim() || null : null,
    lineworks_user_id: form.provider === 'lineworks' ? form.lineworks_user_id.trim() || null : null,
  }
}

/** 文書の配信候補: 有効で、メールだけの宛先ではないもの。 */
export function distributableRecipients<T extends ProviderRecipient>(recipients: T[]): T[] {
  return recipients.filter((r) => r.enabled && r.provider !== 'email')
}

const ERROR_MESSAGES: Record<string, string> = {
  line_user_id_required: 'LINE User ID を入れてください',
  lineworks_user_id_required: 'LINE WORKS User ID を入れてください',
  email_required: 'メールアドレスを入れてください',
  invalid_provider: 'プロバイダが正しくありません',
}

/** Worker の 400 `{"error": "<語>"}` を日本語の文にする。知らない語・形なら null。 */
export function recipientErrorMessage(e: any): string | null {
  const code = e?.data?.error ?? e?.response?._data?.error
  return typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code]! : null
}
