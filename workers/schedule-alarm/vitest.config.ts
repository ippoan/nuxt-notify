import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DO は node 環境で unit test する。`cloudflare:workers` は node に存在しないため、
// DurableObject 基底クラスだけ差し替える。
// coverage は pure ロジック (logic.ts / secret.ts) のみ 100% gate
// (durable-object-worker skill の org 標準。DO class / worker entry は
// cloudflare 依存のため node coverage の対象にしない)。
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/stub-cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/logic.ts", "src/secret.ts"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
