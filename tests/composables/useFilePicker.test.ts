import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { useFilePicker } = await import('../../app/composables/useFilePicker')

describe('useFilePicker', () => {
  const originalShowOpen = (globalThis as any).showOpenFilePicker
  const originalDocument = (globalThis as any).document

  beforeEach(() => {
    delete (globalThis as any).showOpenFilePicker
    delete (globalThis as any).document
  })

  afterEach(() => {
    if (originalShowOpen === undefined) delete (globalThis as any).showOpenFilePicker
    else (globalThis as any).showOpenFilePicker = originalShowOpen
    if (originalDocument === undefined) delete (globalThis as any).document
    else (globalThis as any).document = originalDocument
  })

  describe('File System Access API path', () => {
    it('returns picked files via showOpenFilePicker', async () => {
      const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' })
      const fileB = new File(['bb'], 'b.docx', { type: 'application/vnd.openxmlformats' })
      const showOpenFilePicker = vi.fn().mockResolvedValue([
        { getFile: () => Promise.resolve(fileA) },
        { getFile: () => Promise.resolve(fileB) },
      ])
      ;(globalThis as any).showOpenFilePicker = showOpenFilePicker

      const { pick } = useFilePicker()
      const files = await pick()

      expect(files).toEqual([fileA, fileB])
      expect(showOpenFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({ multiple: true }),
      )
    })

    it('returns empty array on AbortError (user cancels)', async () => {
      const abort = new Error('user aborted')
      abort.name = 'AbortError'
      ;(globalThis as any).showOpenFilePicker = vi.fn().mockRejectedValue(abort)

      const { pick } = useFilePicker()
      expect(await pick()).toEqual([])
    })

    it('rethrows non-AbortError', async () => {
      const boom = new Error('boom')
      ;(globalThis as any).showOpenFilePicker = vi.fn().mockRejectedValue(boom)

      const { pick } = useFilePicker()
      await expect(pick()).rejects.toThrow('boom')
    })

    it('rethrows non-Error rejection', async () => {
      ;(globalThis as any).showOpenFilePicker = vi.fn().mockRejectedValue('string-rejection')

      const { pick } = useFilePicker()
      await expect(pick()).rejects.toBe('string-rejection')
    })
  })

  describe('input[type=file] fallback', () => {
    it('returns files selected via input change', async () => {
      const fileA = new File(['x'], 'x.pdf', { type: 'application/pdf' })
      const input: any = {
        type: '', multiple: false, accept: '',
        onchange: null as null | (() => void),
        files: [fileA] as unknown as FileList,
        click: vi.fn(function (this: any) { this.onchange?.() }),
      }
      ;(globalThis as any).document = { createElement: vi.fn().mockReturnValue(input) }

      const { pick } = useFilePicker()
      const files = await pick()

      expect(files).toEqual([fileA])
      expect(input.type).toBe('file')
      expect(input.multiple).toBe(true)
      expect(input.accept).toContain('.pdf')
      expect(input.click).toHaveBeenCalled()
    })

    it('returns empty array when input has no files', async () => {
      const input: any = {
        type: '', multiple: false, accept: '',
        onchange: null as null | (() => void),
        files: null,
        click: vi.fn(function (this: any) { this.onchange?.() }),
      }
      ;(globalThis as any).document = { createElement: vi.fn().mockReturnValue(input) }

      const { pick } = useFilePicker()
      expect(await pick()).toEqual([])
    })

    it('returns empty array when document is unavailable', async () => {
      // FSA absent + document absent → should resolve to []
      const { pick } = useFilePicker()
      expect(await pick()).toEqual([])
    })
  })
})
