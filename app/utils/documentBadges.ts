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
  // 配車手配票タイトル組み立て (Refs #68)。一覧 API は extracted_data を
  // SELECT * でそのまま返すので、ここから logistics を取り出してタイトル化する。
  extracted_data?: { logistics?: LogisticsFields | null } | Record<string, unknown> | null
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

// ── 抽出 stuck 判定 (Refs #66) ──────────────────────────────────────────
//
// backend の extract は fire-and-forget の tokio::spawn で、Cloud Run の CPU
// throttling 等で background が静かに死ぬと extraction_status が pending の
// まま永久に止まる。updated_at から一定時間動かなければ stuck とみなし、
// 詳細画面で再抽出導線を目立たせる判定に使う。updated_at が無い (旧 API) /
// 不正な値なら判定材料が無いので false にフォールバックする。

/**
 * 抽出が「処理中表示のまま固まっている」か。
 * - extraction_status が pending / processing 以外なら常に false
 * - updated_at が無い / パースできなければ false
 * - now - updated_at が threshold を超えたら true
 */
export function isExtractionStuck(
  extractionStatus: string | undefined | null,
  updatedAt: string | null | undefined,
  nowMs: number,
  thresholdMs: number,
): boolean {
  const inProgress = extractionStatus === 'pending' || extractionStatus === 'processing'
  if (!inProgress) return false
  if (!updatedAt) return false
  const t = new Date(updatedAt).getTime()
  if (Number.isNaN(t)) return false
  return nowMs - t > thresholdMs
}

// ── 配車手配票タイトル組み立て (Refs #68) ───────────────────────────────
//
// rust-alc-api の extract.rs が抽出した logistics (extracted_data.logistics)
// から「積込日時 積込県ー降し日時 降し県　輸送品名」形式のタイトルを組み立てる。
// backend に専用の県 / 品名フィールドは無いので、県は積地 / 降地の住所文字列
// から切り出す。輸送品名 (cargo_name) は backend が将来返したら拾う graceful
// 実装。logistics が無い / 何も組み立てられない時は null を返し、呼び出し側で
// extracted_title || file_name にフォールバックさせる。

/** タイトル組み立てに使う logistics フィールド (extract.rs の LogisticsFields サブセット)。 */
export interface LogisticsFields {
  loading_place?: string | null
  loading_place_address?: string | null
  unloading_place?: string | null
  unloading_place_address?: string | null
  loading_at?: string | null
  unloading_at?: string | null
  /** backend 未対応 (将来 extract.rs が返したら拾う)。 */
  cargo_name?: string | null
  [key: string]: unknown
}

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

/**
 * 住所 / 地名文字列から最初に現れる都道府県を切り出す。見つからなければ null。
 * 複数候補があれば最も前方に出るものを採用 (「〒861 熊本県…」のような prefix
 * ノイズや、住所に他県が含まれるケースに強くする)。
 */
export function extractPrefecture(place?: string | null): string | null {
  if (!place) return null
  let best: { pref: string; idx: number } | null = null
  for (const pref of PREFECTURES) {
    const idx = place.indexOf(pref)
    if (idx >= 0 && (best === null || idx < best.idx)) {
      best = { pref, idx }
    }
  }
  return best?.pref ?? null
}

/**
 * 日時文字列を「MM/DD HH:mm」相当に整形する。ISO 8601 っぽければ圧縮し、
 * Gemini が「11/10 08:00」等の自由文で返した場合はそのまま (trim のみ)。
 */
function formatLogisticsTime(s?: string | null): string {
  if (!s) return ''
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) {
    const d = new Date(t)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  return t
}

/** doc.extracted_data.logistics を安全に取り出す (型が緩いレスポンスに耐える)。 */
function readLogistics(doc: DocumentCardData): LogisticsFields | null {
  const data = doc.extracted_data
  if (!data || typeof data !== 'object') return null
  const l = (data as { logistics?: unknown }).logistics
  if (!l || typeof l !== 'object') return null
  return l as LogisticsFields
}

/**
 * 「積込日時 積込県ー降し日時 降し県　輸送品名」形式のタイトルを組み立てる。
 * 材料が何も無ければ null (呼び出し側で extracted_title 等にフォールバック)。
 */
export function buildLogisticsTitle(doc: DocumentCardData): string | null {
  const l = readLogistics(doc)
  if (!l) return null
  const loadPref = extractPrefecture(l.loading_place ?? l.loading_place_address)
  const unloadPref = extractPrefecture(l.unloading_place ?? l.unloading_place_address)
  const left = [formatLogisticsTime(l.loading_at), loadPref].filter(Boolean).join(' ')
  const right = [formatLogisticsTime(l.unloading_at), unloadPref].filter(Boolean).join(' ')
  const route = [left, right].filter(Boolean).join('ー')
  const cargo = (l.cargo_name ?? '').trim()
  const title = [route, cargo].filter(Boolean).join('　')
  return title || null
}
