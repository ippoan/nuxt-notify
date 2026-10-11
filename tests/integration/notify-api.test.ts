/**
 * Integration tests against local API (docker compose) or staging.
 *
 * CI: docker-compose.test.yml で API 起動 → API_BASE_URL=http://localhost:18080
 * Local (staging): STAGING_API_BASE=https://... STAGING_TENANT_ID=... npx vitest run tests/integration/
 */
import { describe, it, expect } from 'vitest'

const API_BASE = process.env.API_BASE_URL || process.env.STAGING_API_BASE
const TENANT_ID = process.env.STAGING_TENANT_ID || '11111111-1111-1111-1111-111111111111'

const skip = !API_BASE

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const resp = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await resp.text()
  const data = text ? JSON.parse(text) : null
  return { status: resp.status, data }
}

describe.skipIf(skip)('notify API integration', () => {
  // --- Documents ---
  it('GET /notify/documents — list', async () => {
    const { status, data } = await api('/notify/documents')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('GET /notify/documents/search?q=test — search', async () => {
    const { status, data } = await api('/notify/documents/search?q=test')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  // --- Read Tracker ---
  it('GET /notify/read/{random-token} — unknown token returns 404', async () => {
    // 新仕様: 未知 token は 404 (旧仕様の「frontend_url にリダイレクト」を廃止し、
    // 期限内のみ R2 presigned URL に 302 / 期限切れは 410 / 不明は 404 に統一)
    const resp = await fetch(
      `${API_BASE}/api/notify/read/00000000-0000-0000-0000-000000000000`,
      { redirect: 'manual' },
    )
    expect(resp.status).toBe(404)
  })
})
