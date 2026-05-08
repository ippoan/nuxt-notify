import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

// --- Mock @ippoan/auth-client ---
const mockToken = ref<string | null>(null)
vi.mock('@ippoan/auth-client', () => ({
  useAuth: () => ({ token: mockToken }),
}))

// --- Mock Nuxt auto-imports ---
let mountedFn: (() => void) | null = null
let unmountedFn: (() => void) | null = null
vi.stubGlobal('onMounted', (fn: () => void) => {
  mountedFn = fn
})
vi.stubGlobal('onUnmounted', (fn: () => void) => {
  unmountedFn = fn
})

const mockRuntimeConfig = { public: { realtimeBusUrl: '' } }
vi.stubGlobal('useRuntimeConfig', () => mockRuntimeConfig)

// --- Mock WebSocket ---
interface MockWebSocket {
  url: string
  protocols: string[]
  listeners: Record<string, ((e: any) => void)[]>
  closed: boolean
  closeError: boolean
  addEventListener: (type: string, fn: (e: any) => void) => void
  close: () => void
  dispatch: (type: string, data: any) => void
}

let wsInstances: MockWebSocket[] = []
let wsConstructorThrows = false

class MockWS implements MockWebSocket {
  url: string
  protocols: string[]
  listeners: Record<string, ((e: any) => void)[]> = {}
  closed = false
  closeError = false

  constructor(url: string, protocols?: string | string[]) {
    if (wsConstructorThrows) throw new Error('ws ctor failed')
    this.url = url
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
    wsInstances.push(this)
  }

  addEventListener(type: string, fn: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  close() {
    if (this.closeError) throw new Error('close failed')
    this.closed = true
    // 実ブラウザは close() 後に close イベントが非同期で発火する。
    // ここでは同期的に dispatch して useRedactionWatch のクリーンアップ経路を網羅する。
    this.dispatch('close', {})
  }

  dispatch(type: string, data: any) {
    this.listeners[type]?.forEach((fn) => fn(data))
  }
}

vi.stubGlobal('WebSocket', MockWS)

// 動的 import で stub 後に composable を読み込む
const { useRedactionWatch } = await import('../../app/composables/useRedactionWatch')

describe('useRedactionWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    wsInstances = []
    wsConstructorThrows = false
    mockToken.value = null
    mountedFn = null
    unmountedFn = null
    mockRuntimeConfig.public.realtimeBusUrl = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const r = useRedactionWatch()
    // onMounted は手動実行して接続をシミュレート
    mountedFn?.()
    return r
  }

  it('does nothing when realtimeBusUrl is empty', () => {
    mockToken.value = 'jwt'
    setup()
    expect(wsInstances).toHaveLength(0)
  })

  it('does nothing when realtimeBusUrl is undefined (??\'\' fallback)', () => {
    mockToken.value = 'jwt'
    // 古い env / 未設定: runtimeConfig.public.realtimeBusUrl 自体が undefined
    ;(mockRuntimeConfig.public as Record<string, unknown>).realtimeBusUrl = undefined
    setup()
    expect(wsInstances).toHaveLength(0)
  })

  it('does nothing when token is missing', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = null
    setup()
    expect(wsInstances).toHaveLength(0)
  })

  it('connects with bearer protocol when both url and token are present', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt-abc'
    setup()
    expect(wsInstances).toHaveLength(1)
    expect(wsInstances[0]?.url).toBe('wss://r.example/subscribe')
    expect(wsInstances[0]?.protocols).toEqual(['bearer', 'jwt-abc'])
  })

  it('delivers parsed message to registered handler', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    const { onUpdate } = setup()
    const received: any[] = []
    onUpdate((ev) => received.push(ev))

    const ws = wsInstances[0]!
    ws.dispatch('message', {
      data: JSON.stringify({
        tenant_id: 't1',
        document_id: 'd1',
        status: 'completed',
        redactions_applied: 3,
      }),
    })

    expect(received).toHaveLength(1)
    expect(received[0].status).toBe('completed')
    expect(received[0].redactions_applied).toBe(3)
  })

  it('ignores malformed JSON without throwing', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    const { onUpdate } = setup()
    const handler = vi.fn()
    onUpdate(handler)

    const ws = wsInstances[0]!
    ws.dispatch('message', { data: 'not json' })
    ws.dispatch('message', { data: 123 }) // non-string also drop

    expect(handler).not.toHaveBeenCalled()
  })

  it('reconnects 5s after close', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    setup()
    expect(wsInstances).toHaveLength(1)

    wsInstances[0]!.dispatch('close', {})
    expect(wsInstances).toHaveLength(1) // not yet
    vi.advanceTimersByTime(5000)
    expect(wsInstances).toHaveLength(2) // reconnected
  })

  it('schedules reconnect when WebSocket constructor throws', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    wsConstructorThrows = true

    setup()
    expect(wsInstances).toHaveLength(0) // ctor failed → no instance

    // 5s 後に retry。retry 時は ctor が成功するように戻す。
    wsConstructorThrows = false
    vi.advanceTimersByTime(5000)
    expect(wsInstances).toHaveLength(1)
  })

  it('error event does not schedule duplicate reconnect (close handles it)', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    setup()
    const ws = wsInstances[0]!

    ws.dispatch('error', {})
    vi.advanceTimersByTime(5000)
    // close を起こしていないので reconnect は走らない (1 instance のまま)
    expect(wsInstances).toHaveLength(1)
  })

  it('removes handler when unsubscribe is called', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    const { onUpdate } = setup()
    const handler = vi.fn()
    const off = onUpdate(handler)
    off()

    const ws = wsInstances[0]!
    ws.dispatch('message', {
      data: JSON.stringify({ tenant_id: 't', document_id: 'd', status: 'completed' }),
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('unmount closes the open socket', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    setup()
    expect(wsInstances).toHaveLength(1)
    expect(wsInstances[0]!.closed).toBe(false)

    unmountedFn?.()
    expect(wsInstances[0]!.closed).toBe(true)
  })

  it('unmount cancels pending reconnect timer', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    setup()

    // close 後は 5s 後に再接続する pending state
    wsInstances[0]!.dispatch('close', {})
    unmountedFn?.()

    // unmount 後は reconnect が走らない
    vi.advanceTimersByTime(10000)
    expect(wsInstances).toHaveLength(1)
  })

  it('unmount swallows close errors', () => {
    mockRuntimeConfig.public.realtimeBusUrl = 'wss://r.example'
    mockToken.value = 'jwt'
    setup()
    wsInstances[0]!.closeError = true
    expect(() => unmountedFn?.()).not.toThrow()
  })
})
