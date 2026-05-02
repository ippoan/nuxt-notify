/**
 * ローカルファイル選択 composable。
 *
 * - File System Access API (`window.showOpenFilePicker`) をネイティブの picker として使用
 * - 非対応ブラウザ (Safari/Firefox) では `<input type="file">` に自動 fallback
 * - ユーザーがキャンセルした場合 (FSA: AbortError, input: change なし) は `[]` を返す
 */

const ACCEPT_TYPES = [
  {
    description: 'PDF / Office / Image',
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    },
  },
]

const FALLBACK_ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg'

export function useFilePicker() {
  async function pick(): Promise<File[]> {
    const w = globalThis as unknown as {
      showOpenFilePicker?: (opts: unknown) => Promise<Array<{ getFile(): Promise<File> }>>
      document?: Document
    }

    if (typeof w.showOpenFilePicker === 'function') {
      try {
        const handles = await w.showOpenFilePicker({
          multiple: true,
          types: ACCEPT_TYPES,
        })
        return await Promise.all(handles.map((h) => h.getFile()))
      } catch (e) {
        // ユーザーキャンセル等
        if (e instanceof Error && e.name === 'AbortError') return []
        throw e
      }
    }

    // Fallback: input[type=file]
    const doc = w.document
    if (!doc) return []
    return new Promise<File[]>((resolve) => {
      const input = doc.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.accept = FALLBACK_ACCEPT
      input.onchange = () => resolve(Array.from(input.files || []))
      input.click()
    })
  }

  return { pick }
}
