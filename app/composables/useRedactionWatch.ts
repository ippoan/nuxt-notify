// notify-realtime-bus Worker への WebSocket subscribe を管理する composable。
//
// 仕様:
// - `wss://realtime.notify.../subscribe` に接続
// - 認証は `Sec-WebSocket-Protocol: bearer, <jwt>` で送信 (URL に JWT を載せない)
// - DO 側 (rust-alc-api からの broadcast) が JSON メッセージを送ってくる
// - 接続切断時は 5 秒後に再接続 (hibernation で 60s idle disconnect の可能性あり)
// - `onUpdate(handler)` で複数コンポーネントが同じ WS にぶら下がれる (1 接続 / tab)
//
// `realtimeBusUrl` が未設定 (Phase 3 デプロイ前 / 旧環境) の場合は何もせず
// no-op で動作 — 既存 polling が UI 更新を担う。

import { useAuth } from '@ippoan/auth-client'

export interface RedactEvent {
  tenant_id: string
  document_id: string
  status: 'completed' | 'failed' | 'skipped' | string
  redactions_applied?: number
  redaction_error?: string
}

const RECONNECT_DELAY_MS = 5000

export function useRedactionWatch() {
  const { token } = useAuth()
  const config = useRuntimeConfig()
  const realtimeBusUrl = (config.public.realtimeBusUrl as string | undefined) ?? ''

  const handlers = new Set<(ev: RedactEvent) => void>()
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function clearTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function connect() {
    if (!realtimeBusUrl) return // Phase 3 デプロイ前 / 設定なし → no-op
    if (!token.value) return // 未ログイン → 接続しない

    let sock: WebSocket
    try {
      // Sec-WebSocket-Protocol で JWT 送信。
      // 仕様: ブラウザは `new WebSocket(url, ['bearer', jwt])` を
      //  `Sec-WebSocket-Protocol: bearer, <jwt>` ヘッダで送る。
      sock = new WebSocket(`${realtimeBusUrl}/subscribe`, ['bearer', token.value])
    } catch {
      // 構築自体が失敗 (URL 不正等) → 5s 後に再試行
      scheduleReconnect()
      return
    }
    socket = sock

    sock.addEventListener('message', (e) => {
      try {
        const ev = JSON.parse(typeof e.data === 'string' ? e.data : '') as RedactEvent
        handlers.forEach((h) => h(ev))
      } catch {
        // malformed → drop
      }
    })

    sock.addEventListener('close', () => {
      socket = null
      scheduleReconnect()
    })

    sock.addEventListener('error', () => {
      // close も発火するので reconnect は close 側に任せる
    })
  }

  function scheduleReconnect() {
    if (stopped) return
    clearTimer()
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
  }

  function onUpdate(handler: (ev: RedactEvent) => void): () => void {
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }

  onMounted(connect)
  onUnmounted(() => {
    stopped = true
    clearTimer()
    if (socket) {
      try {
        socket.close()
      } catch {
        // already closed
      }
      socket = null
    }
    handlers.clear()
  })

  return { onUpdate }
}
