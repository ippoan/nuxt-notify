import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPdfBytes } from '../../app/utils/preview-fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * PDF preview を pdfjs-dist worker に渡す経路の安全性を pin する。
 *
 * 主訴: tab 切替や WS event で `loadPreview()` が並行呼びされると、PDF.js Worker が
 * 前 buffer を `postMessage(transfer)` で受領後に main thread 側で同じ buffer を
 * 触ると `Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is
 * already detached` が発生する。`fetchPdfBytes` は:
 *   1. `buf.slice(0)` で response の ArrayBuffer から独立 copy を作る (詰め直し)
 *   2. `signal` を受け取り、`fetch` の network 段で abort できる
 * の 2 つを満たすことで上記の race を防ぐ。
 */
describe('fetchPdfBytes', () => {
  it('returns Uint8Array whose backing ArrayBuffer is a *clone*, not the original response buffer', async () => {
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer // "%PDF"
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(original),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchPdfBytes('https://example.com/doc.pdf')
    // bytes 内容は同一
    expect(Array.from(out)).toEqual([0x25, 0x50, 0x44, 0x46])
    // backing ArrayBuffer は独立 instance であること (clone). これが本テストの
    // 中心 assertion: Worker への transfer で original を detach されても
    // out.buffer は別 instance なので影響を受けない。
    expect(out.buffer).not.toBe(original)
    expect(out.buffer.byteLength).toBe(original.byteLength)
  })

  it('forwards signal so an in-flight fetch can be aborted by the caller', async () => {
    const ctrl = new AbortController()
    const observed: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        if (init?.signal) observed.push(init.signal)
        // signal の状態を直接 reject に反映する fake fetch
        return new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }),
    )

    const p = fetchPdfBytes('https://example.com/doc.pdf', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(observed[0]).toBe(ctrl.signal)
  })

  it('forwards headers (e.g. Authorization) to the underlying fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await fetchPdfBytes('https://example.com/doc.pdf', {
      headers: { Authorization: 'Bearer xyz', 'X-Tenant-ID': 't1' },
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ Authorization: 'Bearer xyz', 'X-Tenant-ID': 't1' })
  })

  it('throws with status when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as Response),
    )

    await expect(fetchPdfBytes('https://example.com/doc.pdf')).rejects.toThrow('HTTP 404')
  })

  it('uses default empty init object when caller omits options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchPdfBytes('https://example.com/doc.pdf')
    expect(out).toBeInstanceOf(Uint8Array)
    // 第二引数として `{}` が渡る (signal/headers 無し) こと
    expect(fetchMock.mock.calls[0][1]).toEqual({})
  })
})
