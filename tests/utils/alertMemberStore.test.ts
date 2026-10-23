import { describe, it, expect } from 'vitest'
import { ALERT_GROUP_NAME, createAlertMemberStore, type ApiFetch } from '../../app/utils/alertRecipients'

/** 応答を手で解放できる偽サーバー。members の GET は「呼ばれた時点」の中身を、解放したときに返す。 */
function fakeServer(initial: string[]) {
  const members = new Set(initial)
  const held: { path: string; release: () => void }[] = []
  let holdMembers = false
  const api = (async (path: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method ?? 'GET'
    if (method === 'GET' && path === '/notify/groups') return [{ id: 'g1', name: ALERT_GROUP_NAME }]
    if (method === 'GET' && path === '/notify/groups/g1/members') {
      const snapshot = [...members].map((id) => ({ id, name: id }))
      if (!holdMembers) return snapshot
      return new Promise((resolve) => held.push({ path, release: () => resolve(snapshot) }))
    }
    if (method === 'POST' && path === '/notify/groups/g1/members') {
      for (const id of JSON.parse(options.body!).recipient_ids) members.add(id)
      return {}
    }
    if (method === 'DELETE' && path.startsWith('/notify/groups/g1/members/')) {
      members.delete(path.split('/').pop()!)
      return {}
    }
    throw new Error(`unexpected ${method} ${path}`)
  }) as unknown as ApiFetch
  return {
    api,
    members,
    hold(on: boolean) {
      holdMembers = on
    },
    held,
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createAlertMemberStore (#436: テスト送信の確認が 1 人と出る)', () => {
  it('2 人目をチェックした後、先に始まった古い読み込みが遅れて返っても人数は 2 のまま', async () => {
    const server = fakeServer(['a'])
    let shown = new Set<string>()
    const store = createAlertMemberStore(server.api, (m) => (shown = m), () => {})

    // 画面を開いたときの読み込み (a だけの時点) が遅れている間に、b にチェックを入れる
    server.hold(true)
    const initial = store.load()
    await tick()
    server.hold(false)
    await store.toggle('b', true)
    expect(shown.size).toBe(2)

    // 古い読み込みが今ごろ返る
    server.held.forEach((h) => h.release())
    await initial
    expect(server.members.size).toBe(2)
    expect(shown.size).toBe(2)
  })
})

describe('createAlertMemberStore の他の経路', () => {
  it('読み込みの失敗は空にしてエラーを通知する (Error 以外も文字列化)', async () => {
    const errors: string[] = []
    let shown = new Set(['x'])
    const api = (async () => {
      throw 'boom'
    }) as unknown as ApiFetch
    const store = createAlertMemberStore(api, (m) => (shown = m), (m) => errors.push(m))
    await store.load()
    expect(shown.size).toBe(0)
    expect(errors[0]).toContain('boom')
  })

  it('読み込みの失敗が Error ならその message を出す', async () => {
    const errors: string[] = []
    const api = (async () => {
      throw new Error('down')
    }) as unknown as ApiFetch
    await createAlertMemberStore(api, () => {}, (m) => errors.push(m)).load()
    expect(errors[0]).toContain('down')
  })

  it('古い読み込みの失敗は新しい state を消さない', async () => {
    let call = 0
    const errors: string[] = []
    let shown = new Set<string>()
    let rejectFirst!: (e: Error) => void
    const api = (async (path: string) => {
      if (path === '/notify/groups') {
        call++
        if (call === 1) return new Promise((_, rej) => (rejectFirst = rej))
        return [{ id: 'g1', name: ALERT_GROUP_NAME }]
      }
      return [{ id: 'a', name: 'A', email: 'a@example.com' }, { id: 'b', name: 'B', email: 'b@example.com' }]
    }) as unknown as ApiFetch
    const store = createAlertMemberStore(api, (m) => (shown = m), (m) => errors.push(m))
    const first = store.load()
    await store.load()
    rejectFirst(new Error('old'))
    await first
    expect(shown.size).toBe(2)
    expect(errors).toEqual([])
  })

  it('チェック操作の失敗はエラーを通知し、それでも読み直す', async () => {
    const errors: string[] = []
    let shown = new Set<string>()
    const api = (async (path: string, o: { method?: string } = {}) => {
      if (o.method === 'POST') throw new Error('ng')
      if (path === '/notify/groups') return [{ id: 'g1', name: ALERT_GROUP_NAME }]
      return [{ id: 'a', name: 'A' }]
    }) as unknown as ApiFetch
    const store = createAlertMemberStore(api, (m) => (shown = m), (m) => errors.push(m))
    await store.toggle('b', true)
    expect(errors[0]).toContain('設定に失敗しました: ng')
    expect(shown.size).toBe(1)
  })

  it('チェック操作の失敗が Error 以外でも文字列にして通知する', async () => {
    const errors: string[] = []
    const api = (async (path: string, o: { method?: string } = {}) => {
      if (o.method === 'DELETE') throw 'raw'
      if (path === '/notify/groups') return [{ id: 'g1', name: ALERT_GROUP_NAME }]
      return []
    }) as unknown as ApiFetch
    await createAlertMemberStore(api, () => {}, (m) => errors.push(m)).toggle('a', false)
    expect(errors[0]).toContain('raw')
  })

  it('チェックを外すと人数が減る', async () => {
    const server = fakeServer(['a', 'b'])
    let shown = new Set<string>()
    const store = createAlertMemberStore(server.api, (m) => (shown = m), () => {})
    await store.toggle('a', false)
    expect([...shown]).toEqual(['b'])
  })
})

describe('createAlertMemberStore のグループ名と呼び名', () => {
  it('血圧の日報のグループを読み書きし、エラー文に呼び名を使う', async () => {
    const members = new Set<string>(['a'])
    const seen: string[] = []
    const api = (async (path: string, options: { method?: string; body?: string } = {}) => {
      const method = options.method ?? 'GET'
      seen.push(`${method} ${path}`)
      if (path === '/notify/groups') return [{ id: 'g9', name: '血圧の日報' }]
      if (path === '/notify/groups/g9/members' && method === 'GET') return [...members].map((id) => ({ id }))
      if (path === '/notify/groups/g9/members' && method === 'POST') {
        for (const id of JSON.parse(options.body!).recipient_ids) members.add(id)
        return {}
      }
      throw new Error('boom')
    }) as unknown as ApiFetch
    let shown = new Set<string>()
    const errors: string[] = []
    const store = createAlertMemberStore(api, (m) => (shown = m), (m) => errors.push(m), {
      groupName: '血圧の日報',
      label: '血圧の日報',
    })
    await store.load()
    expect([...shown]).toEqual(['a'])
    await store.toggle('b', true)
    expect([...shown].sort()).toEqual(['a', 'b'])
    expect(seen.every((s) => !s.includes('g1'))).toBe(true)
    // 読み込みの失敗 (グループ一覧が落ちる)
    const failing = createAlertMemberStore(
      (async () => {
        throw new Error('down')
      }) as unknown as ApiFetch,
      () => {},
      (m) => errors.push(m),
      { label: '血圧の日報' },
    )
    await failing.load()
    await failing.toggle('c', false)
    expect(errors[0]).toBe('血圧の日報の受け取り手を読み込めませんでした: down')
    expect(errors[1]).toBe('血圧の日報の設定に失敗しました: down')
  })
})
