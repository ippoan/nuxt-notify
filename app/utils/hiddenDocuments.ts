// ドキュメント一覧の「非表示」をクライアントサイド (localStorage) で管理する。
//
// Option A (Refs #70): バックエンド改修なしで「削除はしたくないが一覧から消したい」
// を満たす。端末をまたぐと状態は共有されない (localStorage のため) のが既知の制約。
// サーバ永続化が必要になったら Option B (notify_documents.hidden_at) に移行する。
//
// SSR / localStorage 非対応環境 (プライベートモード等) では黙って no-op / 空集合に
// フォールバックし、呼び出し側を壊さない (fail-open)。

const STORAGE_KEY = 'notify:hidden-documents'

function read(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    // 壊れた JSON / getItem 例外は空集合扱い
    return new Set()
  }
}

function write(ids: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // 容量超過 / プライベートモードの setItem 例外は黙って無視
  }
}

/** 現在の非表示 ID 集合を返す (localStorage から都度読む)。 */
export function getHiddenIds(): Set<string> {
  return read()
}

/** 指定 ID が非表示かどうか。 */
export function isHidden(id: string): boolean {
  return read().has(id)
}

/** ID を非表示にして、更新後の集合を返す。 */
export function hideDocument(id: string): Set<string> {
  const ids = read()
  ids.add(id)
  write(ids)
  return ids
}

/** ID の非表示を解除して、更新後の集合を返す。 */
export function unhideDocument(id: string): Set<string> {
  const ids = read()
  ids.delete(id)
  write(ids)
  return ids
}
