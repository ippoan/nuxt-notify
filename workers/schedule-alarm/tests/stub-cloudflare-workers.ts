// vitest (node) 用の `cloudflare:workers` 差し替え。
// 実 runtime と同じく constructor(ctx, env) を this.ctx / this.env に束縛するだけ。
export class DurableObject<E = unknown> {
  protected ctx: any;
  protected env: E;
  constructor(ctx: any, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
