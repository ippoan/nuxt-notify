import { describe, it, expect, vi, beforeEach } from 'vitest'

// 転送 + introspect + ACL + OIDC mint + identity 注入の本体は auth-worker
// `/alc-proxy/*` に集約 (#434 step 3 方式 B)。consumer の server route は
// createAuthWorkerProxyHandler で service binding (AUTH_WORKER) に thin-forward
// するだけ。ここでは本 repo の server route の wiring を固定する:
//   1. INTERNAL_SHARED_SECRET binding を resolve して渡す (未設定は 503)
//   2. AUTH_WORKER service binding を解決して authWorkerFetch を渡す (未設定は 503)
//   3. createAuthWorkerProxyHandler の戻り値で proxy(event) を返す

const { createAuthWorkerProxyHandlerMock, proxyFn, createErrorMock } = vi.hoisted(() => {
  const proxyFn = vi.fn(() => 'PROXY_RESULT')
  ;(globalThis as Record<string, unknown>).defineEventHandler = (fn: unknown) => fn
  const createErrorMock = vi.fn((opts: unknown) => {
    const err = new Error('createError') as Error & { opts?: unknown }
    err.opts = opts
    throw err
  })
  ;(globalThis as Record<string, unknown>).createError = createErrorMock
  return {
    proxyFn,
    createAuthWorkerProxyHandlerMock: vi.fn((_opts: unknown) => proxyFn),
    createErrorMock,
  }
})
vi.mock('@ippoan/auth-client/server', () => ({
  createAuthWorkerProxyHandler: createAuthWorkerProxyHandlerMock,
}))

import handler from '../../server/api/proxy/[...path]'

interface ProxyWiring {
  sharedSecret: string
  authWorkerFetch: () => typeof fetch
}

const call = (event: unknown) => (handler as unknown as (e: unknown) => Promise<unknown>)(event)
const eventWith = (env: Record<string, unknown>) => ({ context: { cloudflare: { env } } })

describe('proxy handler wiring (createAuthWorkerProxyHandler, #434 方式 B)', () => {
  beforeEach(() => {
    createAuthWorkerProxyHandlerMock.mockClear()
    proxyFn.mockClear()
    createErrorMock.mockClear()
  })

  it('INTERNAL_SHARED_SECRET + AUTH_WORKER があれば委譲し proxy(event) を返す', async () => {
    const authFetch = vi.fn()
    const event = eventWith({
      INTERNAL_SHARED_SECRET: 'secret-x',
      AUTH_WORKER: { fetch: authFetch },
    })
    const res = await call(event)
    expect(createAuthWorkerProxyHandlerMock).toHaveBeenCalledTimes(1)
    const opts = createAuthWorkerProxyHandlerMock.mock.calls[0]![0] as ProxyWiring
    expect(opts.sharedSecret).toBe('secret-x')
    // authWorkerFetch() は AUTH_WORKER.fetch (binding 済み) を返す
    expect(typeof opts.authWorkerFetch).toBe('function')
    const bound = opts.authWorkerFetch()
    bound('https://alc-proxy.internal/alc-proxy/api/x')
    expect(authFetch).toHaveBeenCalled()
    expect(proxyFn).toHaveBeenCalledWith(event)
    expect(res).toBe('PROXY_RESULT')
  })

  it('INTERNAL_SHARED_SECRET が Secrets Store binding (.get()) でも解決する', async () => {
    const event = eventWith({
      INTERNAL_SHARED_SECRET: { get: async () => 'from-store' },
      AUTH_WORKER: { fetch: vi.fn() },
    })
    await call(event)
    const opts = createAuthWorkerProxyHandlerMock.mock.calls[0]![0] as ProxyWiring
    expect(opts.sharedSecret).toBe('from-store')
  })

  it('INTERNAL_SHARED_SECRET 未設定なら 503 で弾く (委譲しない)', async () => {
    await expect(call(eventWith({ AUTH_WORKER: { fetch: vi.fn() } }))).rejects.toThrow()
    expect(createErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    )
    expect(createAuthWorkerProxyHandlerMock).not.toHaveBeenCalled()
  })

  it('AUTH_WORKER service binding 未設定なら 503 で弾く (委譲しない)', async () => {
    await expect(call(eventWith({ INTERNAL_SHARED_SECRET: 'x' }))).rejects.toThrow()
    expect(createErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    )
    expect(createAuthWorkerProxyHandlerMock).not.toHaveBeenCalled()
  })
})
