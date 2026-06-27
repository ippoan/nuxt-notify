import { describe, it, expect, vi, beforeEach } from 'vitest'

// Nitro グローバル (defineEventHandler / createError / getHeader / getRouterParam /
// readBody / setResponseHeader) を globalThis に立てる (proxy.test.ts と同方式)。
const { createErrorMock, headers, routerParams, bodyRef, setHeaderMock } = vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).defineEventHandler = (fn: unknown) => fn
  const createErrorMock = vi.fn((opts: { statusCode: number; statusMessage?: string }) => {
    const err = new Error(opts.statusMessage ?? 'error') as Error & { statusCode?: number }
    err.statusCode = opts.statusCode
    return err
  })
  ;(globalThis as Record<string, unknown>).createError = createErrorMock
  const headers: Record<string, string> = {}
  const routerParams: Record<string, string> = {}
  const bodyRef: { value: unknown } = { value: undefined }
  ;(globalThis as Record<string, unknown>).getHeader = (_e: unknown, k: string) => headers[k.toLowerCase()]
  ;(globalThis as Record<string, unknown>).getRouterParam = (_e: unknown, k: string) => routerParams[k]
  ;(globalThis as Record<string, unknown>).readBody = async () => bodyRef.value
  const setHeaderMock = vi.fn()
  ;(globalThis as Record<string, unknown>).setResponseHeader = setHeaderMock
  // read-status route が使う Nitro グローバル。
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    public: { authWorkerUrl: 'https://auth.example' },
  })
  return { createErrorMock, headers, routerParams, bodyRef, setHeaderMock }
})

// read-status は requireAuth (introspect) で tenant_id を得る。テストでは固定 tenant に mock。
vi.mock('@ippoan/auth-client/server', () => ({
  requireAuth: vi.fn(async () => ({
    active: true,
    tenant_id: 'tn-1',
    role: 'admin',
    email: 'a@example.com',
    sub: 'u-1',
  })),
}))

import registerView from '../../server/api/notify/register-view.post'
import viewMeta from '../../server/api/notify/v/[token].get'
import viewFile from '../../server/api/notify/v/[token]/file.get'
import viewImage from '../../server/api/notify/v/[token]/image.jpg.get'
import readStatus from '../../server/api/notify/read-status/[documentId].get'

const call = (h: unknown, e: unknown) => (h as (e: unknown) => Promise<unknown>)(e)
const eventWith = (env: Record<string, unknown>) => ({ context: { cloudflare: { env } } })

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    put: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    list: vi.fn(async ({ prefix }: { prefix: string; cursor?: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true as const,
    })),
  }
}
function fakeR2(objects: Record<string, Uint8Array> = {}) {
  return {
    get: vi.fn(async (k: string) =>
      objects[k] ? { arrayBuffer: async () => objects[k].buffer } : null,
    ),
  }
}

const future = '2099-01-01T00:00:00.000Z'
const past = '2000-01-01T00:00:00.000Z'
function viewRec(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    r2_key: 'tenant/m/file.pdf',
    tenant_id: 'tn-1',
    document_id: 'doc-1',
    recipient_id: 'rcp-1',
    file_name: 'file.pdf',
    file_size_bytes: 10,
    source_subject: 's',
    source_sender: 'f',
    source_received_at: future,
    expire_at: future,
    ...over,
  })
}

async function expectStatus(p: Promise<unknown>, code: number) {
  await expect(p).rejects.toMatchObject({ statusCode: code })
}

beforeEach(() => {
  createErrorMock.mockClear()
  setHeaderMock.mockClear()
  for (const k of Object.keys(headers)) delete headers[k]
  for (const k of Object.keys(routerParams)) delete routerParams[k]
  bodyRef.value = undefined
})

describe('register-view', () => {
  it('INTERNAL_SHARED_SECRET 未設定は 503', async () => {
    await expectStatus(call(registerView, eventWith({})), 503)
  })
  it('secret 不一致は 401', async () => {
    headers['x-notify-internal-secret'] = 'wrong'
    await expectStatus(call(registerView, eventWith({ INTERNAL_SHARED_SECRET: 'right' })), 401)
  })
  it('KV 未設定は 503', async () => {
    headers['x-notify-internal-secret'] = 'right'
    await expectStatus(call(registerView, eventWith({ INTERNAL_SHARED_SECRET: 'right' })), 503)
  })
  it('token 欠落は 400', async () => {
    headers['x-notify-internal-secret'] = 'right'
    bodyRef.value = { r2_key: 'k', document_id: 'd', recipient_id: 'r', expire_at: future }
    const kv = fakeKv()
    await expectStatus(call(registerView, eventWith({ INTERNAL_SHARED_SECRET: 'right', NOTIFY_VIEW_KV: kv })), 400)
  })
  it('必須欠落 body は 400', async () => {
    headers['x-notify-internal-secret'] = 'right'
    bodyRef.value = { token: 't' }
    const kv = fakeKv()
    await expectStatus(call(registerView, eventWith({ INTERNAL_SHARED_SECRET: 'right', NOTIFY_VIEW_KV: kv })), 400)
  })
  it('正常は KV に view:{token} を put', async () => {
    headers['x-notify-internal-secret'] = 'right'
    bodyRef.value = { token: 'tok', tenant_id: 'tn', r2_key: 'k', document_id: 'd', recipient_id: 'r', expire_at: future }
    const kv = fakeKv()
    const res = await call(registerView, eventWith({ INTERNAL_SHARED_SECRET: 'right', NOTIFY_VIEW_KV: kv }))
    expect(res).toEqual({ ok: true })
    expect(kv.put).toHaveBeenCalledTimes(1)
    expect(kv.put.mock.calls[0]![0]).toBe('view:tok')
    expect(kv.put.mock.calls[0]![2]).toMatchObject({ expirationTtl: expect.any(Number) })
  })
})

describe('GET /v/{token} metadata', () => {
  it('KV 未設定は 503', async () => {
    routerParams.token = 'x'
    await expectStatus(call(viewMeta, eventWith({})), 503)
  })
  it('不在は 404', async () => {
    routerParams.token = 'x'
    await expectStatus(call(viewMeta, eventWith({ NOTIFY_VIEW_KV: fakeKv() })), 404)
  })
  it('失効は 410', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec({ expire_at: past }) })
    await expectStatus(call(viewMeta, eventWith({ NOTIFY_VIEW_KV: kv })), 410)
  })
  it('正常はメタ + content_type を返し r2_key を隠す、既読を記録', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec() })
    const res = (await call(viewMeta, eventWith({ NOTIFY_VIEW_KV: kv }))) as Record<string, unknown>
    expect(res.content_type).toBe('application/pdf')
    expect(res.file_name).toBe('file.pdf')
    expect(JSON.stringify(res)).not.toContain('r2_key')
    // 既読 read:{tenant}:doc-1:rcp-1 が書かれる (tenant prefix)
    expect(kv.store.has('read:tn-1:doc-1:rcp-1')).toBe(true)
  })
  it('既読が既存なら上書きしない', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({
      'view:tok': viewRec(),
      'read:tn-1:doc-1:rcp-1': JSON.stringify({ read_at: 'orig', recipient_id: 'rcp-1' }),
    })
    await call(viewMeta, eventWith({ NOTIFY_VIEW_KV: kv }))
    expect(JSON.parse(kv.store.get('read:tn-1:doc-1:rcp-1')!).read_at).toBe('orig')
  })
})

describe('GET /v/{token}/file', () => {
  it('binding 未設定は 503', async () => {
    routerParams.token = 'x'
    await expectStatus(call(viewFile, eventWith({ NOTIFY_VIEW_KV: fakeKv() })), 503)
  })
  it('不在 token は 404', async () => {
    routerParams.token = 'x'
    await expectStatus(call(viewFile, eventWith({ NOTIFY_VIEW_KV: fakeKv(), NOTIFY_R2: fakeR2() })), 404)
  })
  it('失効は 410', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec({ expire_at: past }) })
    await expectStatus(call(viewFile, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: fakeR2() })), 410)
  })
  it('R2 object 不在は 404', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec() })
    await expectStatus(call(viewFile, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: fakeR2() })), 404)
  })
  it('正常は bytes + content-type/disposition', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec() })
    const r2 = fakeR2({ 'tenant/m/file.pdf': new Uint8Array([1, 2, 3]) })
    const res = (await call(viewFile, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: r2 }))) as Uint8Array
    expect(Array.from(res)).toEqual([1, 2, 3])
    expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'content-type', 'application/pdf')
    // defense-in-depth headers
    expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'x-content-type-options', 'nosniff')
    expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'content-security-policy', "default-src 'none'; sandbox")
  })
  it('inline 不可な型 (svg) は octet-stream + attachment に倒す', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec({ r2_key: 'tenant/m/evil.svg' }) })
    const r2 = fakeR2({ 'tenant/m/evil.svg': new Uint8Array([1]) })
    await call(viewFile, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: r2 }))
    expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'content-type', 'application/octet-stream')
    const cd = setHeaderMock.mock.calls.find((c) => c[1] === 'content-disposition')?.[2]
    expect(String(cd).startsWith('attachment;')).toBe(true)
  })
})

describe('GET /v/{token}/image.jpg', () => {
  it('非 redacted (pdf) は 415', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec() })
    await expectStatus(call(viewImage, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: fakeR2() })), 415)
  })
  it('redacted .jpg は image/jpeg で配信', async () => {
    routerParams.token = 'tok'
    const kv = fakeKv({ 'view:tok': viewRec({ r2_key: 'tenant/m/redacted.jpg' }) })
    const r2 = fakeR2({ 'tenant/m/redacted.jpg': new Uint8Array([9]) })
    const res = (await call(viewImage, eventWith({ NOTIFY_VIEW_KV: kv, NOTIFY_R2: r2 }))) as Uint8Array
    expect(Array.from(res)).toEqual([9])
    expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'content-type', 'image/jpeg')
  })
})

describe('GET /read-status/{documentId}', () => {
  it('KV 未設定は 503', async () => {
    routerParams.documentId = 'doc-1'
    await expectStatus(call(readStatus, eventWith({})), 503)
  })
  it('INTERNAL_SHARED_SECRET 未設定は 503', async () => {
    routerParams.documentId = 'doc-1'
    await expectStatus(call(readStatus, eventWith({ NOTIFY_VIEW_KV: fakeKv() })), 503)
  })
  it('tenant scope で reads を返す (別 tenant の read は除外)', async () => {
    routerParams.documentId = 'doc-1'
    const kv = fakeKv({
      'read:tn-1:doc-1:rcp-1': JSON.stringify({ read_at: 't1', recipient_id: 'rcp-1' }),
      'read:tn-1:doc-1:rcp-2': JSON.stringify({ read_at: 't2', recipient_id: 'rcp-2' }),
      // 別 tenant / 別 doc は prefix 外なので返らない
      'read:tn-OTHER:doc-1:rcp-9': JSON.stringify({ read_at: 'x', recipient_id: 'rcp-9' }),
      'read:tn-1:doc-2:rcp-3': JSON.stringify({ read_at: 'y', recipient_id: 'rcp-3' }),
    })
    const res = (await call(
      readStatus,
      eventWith({ NOTIFY_VIEW_KV: kv, INTERNAL_SHARED_SECRET: 'sek' }),
    )) as { reads: Record<string, string> }
    expect(res.reads).toEqual({ 'rcp-1': 't1', 'rcp-2': 't2' })
  })
})
