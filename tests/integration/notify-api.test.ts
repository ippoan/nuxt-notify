/**
 * Integration tests against local API (docker compose) or staging.
 *
 * CI: docker-compose.test.yml で API 起動 → API_BASE_URL=http://localhost:18080
 * Local (staging): STAGING_API_BASE=https://... STAGING_TENANT_ID=... npx vitest run tests/integration/
 */
import { describe, it, expect, afterAll } from 'vitest'

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
  let createdRecipientId: string

  // --- Seed data check ---
  it('GET /notify/recipients — seed data exists', async () => {
    const { status, data } = await api('/notify/recipients')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  // --- Recipients CRUD ---
  it('POST /notify/recipients — create', async () => {
    const { status, data } = await api('/notify/recipients', {
      method: 'POST',
      body: {
        name: 'Integration Test User',
        provider: 'line',
        line_user_id: `U_integration_${Date.now()}`,
        phone_number: '090-0000-0000',
      },
    })
    expect(status).toBe(201)
    expect(data.name).toBe('Integration Test User')
    expect(data.provider).toBe('line')
    expect(data.enabled).toBe(true)
    createdRecipientId = data.id
  })

  it('GET /notify/recipients/{id} — get by id', async () => {
    const { status, data } = await api(`/notify/recipients/${createdRecipientId}`)
    expect(status).toBe(200)
    expect(data.id).toBe(createdRecipientId)
  })

  it('PUT /notify/recipients/{id} — update', async () => {
    const { status, data } = await api(`/notify/recipients/${createdRecipientId}`, {
      method: 'PUT',
      body: { name: 'Updated Name', enabled: false },
    })
    expect(status).toBe(200)
    expect(data.name).toBe('Updated Name')
    expect(data.enabled).toBe(false)
  })

  it('DELETE /notify/recipients/{id}', async () => {
    const { status } = await api(`/notify/recipients/${createdRecipientId}`, {
      method: 'DELETE',
    })
    expect(status).toBe(204)
  })

  it('GET /notify/recipients/{id} — deleted returns 404', async () => {
    const { status } = await api(`/notify/recipients/${createdRecipientId}`)
    expect(status).toBe(404)
  })

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

  // --- Test Distribute ---
  it('POST /notify/test-distribute — with no active recipients', async () => {
    // Clean up any test recipients
    const { data: recipients } = await api('/notify/recipients')
    for (const r of recipients as any[]) {
      if (r.name.includes('Integration Test')) {
        await api(`/notify/recipients/${r.id}`, { method: 'DELETE' })
      }
    }

    const { status, data } = await api('/notify/test-distribute', {
      method: 'POST',
      body: { message: 'Integration test message' },
    })
    expect(status).toBe(200)
    // seed recipients exist but have no real LINE/LW credentials → failed or sent=0
    expect(typeof data.total).toBe('number')
  })

  // --- Read Tracker ---
  it('GET /notify/read/{random-token} — unknown token redirects', async () => {
    const resp = await fetch(
      `${API_BASE}/api/notify/read/00000000-0000-0000-0000-000000000000`,
      { redirect: 'manual' },
    )
    expect(resp.status).toBe(302)
  })

  // --- Cleanup ---
  afterAll(async () => {
    const { data: remaining } = await api('/notify/recipients')
    for (const r of remaining as any[]) {
      if (r.name.includes('Integration Test')) {
        await api(`/notify/recipients/${r.id}`, { method: 'DELETE' })
      }
    }
  })
})
