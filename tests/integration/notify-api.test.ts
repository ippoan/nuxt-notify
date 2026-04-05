/**
 * Integration live tests against staging API.
 * Requires STAGING_API_BASE and STAGING_TENANT_ID env vars.
 * Tenant must already exist (use staging/import beforehand).
 *
 * Run: STAGING_API_BASE=https://rust-alc-api-staging-566bls5vfq-an.a.run.app \
 *      STAGING_TENANT_ID=11111111-1111-1111-1111-111111111111 \
 *      npx vitest run tests/integration/
 */
import { describe, it, expect, afterAll } from 'vitest'

const API_BASE = process.env.STAGING_API_BASE
const TENANT_ID = process.env.STAGING_TENANT_ID

const skip = !API_BASE || !TENANT_ID

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const resp = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID!,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await resp.text()
  const data = text ? JSON.parse(text) : null
  return { status: resp.status, data }
}

describe.skipIf(skip)('notify API integration (staging)', () => {
  let createdRecipientId: string

  // --- Recipients CRUD ---
  it('GET /notify/recipients — list', async () => {
    const { status, data } = await api('/notify/recipients')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('POST /notify/recipients — create', async () => {
    const { status, data } = await api('/notify/recipients', {
      method: 'POST',
      body: {
        name: 'Live Test User',
        provider: 'line',
        line_user_id: `U_live_test_${Date.now()}`,
        phone_number: '090-0000-0000',
      },
    })
    expect(status).toBe(201)
    expect(data.name).toBe('Live Test User')
    expect(data.provider).toBe('line')
    expect(data.enabled).toBe(true)
    createdRecipientId = data.id
  })

  it('GET /notify/recipients/{id} — get by id', async () => {
    const { status, data } = await api(`/notify/recipients/${createdRecipientId}`)
    expect(status).toBe(200)
    expect(data.id).toBe(createdRecipientId)
    expect(data.name).toBe('Live Test User')
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

  // --- Test Distribute (no recipients → 0 sent) ---
  it('POST /notify/test-distribute — no recipients', async () => {
    // Clean up any recipients first
    const { data: recipients } = await api('/notify/recipients')
    for (const r of recipients as any[]) {
      await api(`/notify/recipients/${r.id}`, { method: 'DELETE' })
    }

    const { status, data } = await api('/notify/test-distribute', {
      method: 'POST',
      body: { message: 'Integration test message' },
    })
    expect(status).toBe(200)
    expect(data.total).toBe(0)
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
      if (r.name.includes('Live Test') || r.name.includes('テスト')) {
        await api(`/notify/recipients/${r.id}`, { method: 'DELETE' })
      }
    }
  })
})
