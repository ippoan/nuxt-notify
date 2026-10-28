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
  // 文書の閲覧の口 (一覧・search など) は alc-notify-worker へ移り rust から消えた (W8c-1、Refs ippoan/rust-alc-api#680)。
  // Release Wave の compat の記録を続けるため、W8c-2 まで rust に残る口を副作用なしで 1 本叩く: 無い文書の DELETE は
  // 行が無いので DB も R2 も触らず 404 (rust の email_documents.rs の delete_document)。W8c-2 でこの口を移すときに置き換える。
  it('DELETE /notify/documents/{無い id} — 404', async () => {
    const { status } = await api(`/notify/documents/${crypto.randomUUID()}`, { method: 'DELETE' })
    expect(status).toBe(404)
  })
})
