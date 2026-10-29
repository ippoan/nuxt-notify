// マスク・抽出のやり直しの後に、状態が終わる (completed / failed / skipped) まで polling で追うための判定
// (Refs ippoan/rust-alc-api#680 W8c-2)。
//
// 終わりは notify-realtime-bus の WS でも届くが、WS が来なくても (切断・push の失敗) 画面が切り替わるように、
// 詳細と一覧は polling でも追う。画面 (pages/documents/[id].vue・pages/index.vue) は判定をここに任せる。

/** polling の間隔 */
export const POLL_INTERVAL_MS = 5000
/** 取得の失敗がこの回数続いたら止める (1 回の失敗では止めない) */
export const POLL_MAX_FAILURES = 3
/** 追いかける長さの上限 (背景処理の送り直しは 30 秒・60 秒後なので、それより十分長く) */
export const POLL_MAX_DURATION_MS = 10 * 60 * 1000

/** 処理中か (やり直しの直後の pending と、背景処理の processing) */
export function isInProgress(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'processing'
}

/** 詳細画面: マスクか抽出のどちらかが処理中なら追い続ける */
export function shouldPollDocument(
  redactionStatus: string | null | undefined,
  extractionStatus: string | null | undefined,
): boolean {
  return isInProgress(redactionStatus) || isInProgress(extractionStatus)
}

/** マスクが completed に変わった瞬間か (プレビューを読み直すのはこのときだけ) */
export function becameCompleted(
  prev: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return prev !== 'completed' && next === 'completed'
}

export interface PolledDocument {
  id: string
  redaction_status?: string | null
  extraction_status?: string | null
}

/** 一覧: 追いかけている文書のうち、まだ処理中のもの (一覧から消えた文書は追わない) */
export function inProgressIds(docs: PolledDocument[], watched: Iterable<string>): Set<string> {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const out = new Set<string>()
  for (const id of watched) {
    const d = byId.get(id)
    if (d && (isInProgress(d.redaction_status) || isInProgress(d.extraction_status))) out.add(id)
  }
  return out
}

/** 一覧を開いたときに追い始める文書 (マスクが processing のもの = 背景処理が動いている) */
export function processingIds(docs: PolledDocument[]): Set<string> {
  return new Set(docs.filter((d) => d.redaction_status === 'processing').map((d) => d.id))
}

/** 次の polling を続けるか (失敗の連続回数と経過時間で止める) */
export function keepPolling(failures: number, startedAtMs: number, nowMs: number): boolean {
  return failures < POLL_MAX_FAILURES && nowMs - startedAtMs < POLL_MAX_DURATION_MS
}
