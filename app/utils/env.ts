/** テスト時に vi.mock('~/utils/env') でモック可能な SSR ガード */
export const isClient = import.meta.client
