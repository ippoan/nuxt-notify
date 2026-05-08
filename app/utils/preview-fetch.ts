/**
 * Fetch a PDF as `Uint8Array` with abort + ArrayBuffer cloning.
 *
 * 用途: VuePdfEmbed / pdfjs-dist に bytes を渡すための共通取得経路。
 * 認証付きで取りたいので URL 直渡しは使えず、`fetch` → `arrayBuffer()` → `Uint8Array`
 * の流れを切り出している。
 *
 * 重要: 返す `Uint8Array` の backing `ArrayBuffer` は **元の response から切り離した
 * 独立コピー** (`buf.slice(0)`)。pdfjs-dist worker は内部で `postMessage(transfer)`
 * を行い、渡した buffer を detach する。tab 切替 / WS イベント / 再 redact 完了
 * polling が並行して `loadPreview()` を呼ぶと、PDF.js Worker がまだ前 buffer を
 * 処理している間に新しい代入が走り、`Failed to execute 'postMessage' on 'Worker':
 * ArrayBuffer at index 0 is already detached` が発生する。clone することで
 * Worker に渡す buffer は新規 instance になり、main thread 側の他参照とは切り離される。
 *
 * `signal` を渡せば `AbortController.abort()` で network 段階で fetch を中断でき、
 * 古い ArrayBuffer が Worker に届く前に止められる。
 */
export async function fetchPdfBytes(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  // `.slice(0)` で独立 ArrayBuffer をコピー。元 buf が Worker に transfer されて
  // detach されても、戻り値の Uint8Array.buffer は別 instance なので influence 0。
  return new Uint8Array(buf.slice(0))
}
