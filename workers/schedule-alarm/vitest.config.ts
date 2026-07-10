import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DO は node 環境で unit test する (realtime-bus は "no tests yet" だが本 worker は
// alarm/retry 分岐が多いのでテスト必須)。`cloudflare:workers` は node に存在しない
// ため、DurableObject 基底クラスだけ差し替える。
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
  },
});
