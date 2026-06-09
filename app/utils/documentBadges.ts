// ドキュメントカード共通のバッジ / フォーマットヘルパ (Refs #69)。
//
// ダッシュボード一覧 (app/pages/index.vue) と DocumentCard / メール詳細
// (app/pages/emails/[id].vue) で共有する。表示ロジックを 1 箇所に集約し、
// 画面間で見た目・文言を揃えるための単一の出所。

export interface BadgeView {
  label: string
  cls: string
}

/** redactionBadge が必要とする最小フィールド (NotifyDocument のサブセット)。 */
export interface RedactionBadgeInput {
  file_name: string | null
  redaction_status?: string
  redactions_applied?: number | null
}

/** DocumentCard.vue が描画に使うドキュメントの形 (rich フィールドは任意)。 */
export interface DocumentCardData extends RedactionBadgeInput {
  id: string
  extracted_title?: string | null
  extracted_summary?: string | null
  source_sender?: string | null
  source_subject?: string | null
  created_at: string
  extraction_status?: string
  distribution_status?: string
}

export function extractionBadge(status: string): BadgeView {
  switch (status) {
    case 'completed':
      return { label: '抽出済', cls: 'bg-green-100 text-green-700' }
    case 'failed':
      return { label: '抽出失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: '抽出待ち', cls: 'bg-yellow-100 text-yellow-700' }
    default:
      return { label: status, cls: 'bg-gray-100 text-gray-600' }
  }
}

export function distributionBadge(status: string): BadgeView {
  switch (status) {
    case 'completed':
      return { label: '配信済', cls: 'bg-green-100 text-green-700' }
    case 'in_progress':
      return { label: '配信中', cls: 'bg-blue-100 text-blue-700' }
    case 'failed':
      return { label: '配信失敗', cls: 'bg-red-100 text-red-700' }
    default:
      return { label: '未配信', cls: 'bg-gray-100 text-gray-600' }
  }
}

// redaction_status: PDF アップロード時に async で金額マスク (migration 109)。
// completed / skipped 以外は配信時に backend で 400 ブロックされる。
// 注: PR #314 が production にデプロイされる前は API が redaction_status を
//     返さない (undefined) → 「マスク待ち」扱いで PDF にだけバッジ表示する。
export function redactionBadge(doc: RedactionBadgeInput): BadgeView | null {
  const isPdf = (doc.file_name ?? '').toLowerCase().endsWith('.pdf')
  switch (doc.redaction_status) {
    case 'completed':
      return {
        label: doc.redactions_applied != null ? `🔒 ${doc.redactions_applied}箇所` : '🔒 マスク済',
        cls: 'bg-emerald-100 text-emerald-700',
      }
    case 'processing':
      return { label: '🔄 マスク処理中', cls: 'bg-blue-100 text-blue-700' }
    case 'failed':
      return { label: '⚠️ マスク失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return isPdf ? { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' } : null
    case 'skipped':
      // PDF 以外は表示しない (ノイズ削減)
      return null
    default:
      // undefined: PR #314 未デプロイの API レスポンス。
      // PDF だけ「マスク待ち」を出して Phase 3 移行を促す。
      return isPdf ? { label: 'マスク待ち', cls: 'bg-gray-100 text-gray-600' } : null
  }
}

/** 配信履歴テーブルの状態バッジ (メール詳細)。 */
export function deliveryStatusLabel(status: string): BadgeView {
  switch (status) {
    case 'sent':
      return { label: '送信済', cls: 'bg-green-100 text-green-700' }
    case 'failed':
      return { label: '失敗', cls: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: '未送信', cls: 'bg-gray-100 text-gray-700' }
    default:
      return { label: status, cls: 'bg-gray-100 text-gray-700' }
  }
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(s: string | null): string {
  if (!s) return '-'
  return new Date(s).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
