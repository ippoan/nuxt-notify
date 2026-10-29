import { defineConfig } from "vitest/config";

// この worker の vitest の設定。置かないと vitest が親のディレクトリを遡り、リポジトリ直下 (Nuxt) の
// vitest.config.ts を拾って落ちる (直下は CI の working_directory で npm install されない)。
// email-receiver の vitest.config.ts と同じ形。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      // 単体テストを持つのは /broadcast の照合の判定だけ (index.ts・redact-bus.ts は Workers の実物で確かめる)
      include: ["src/auth.ts"],
    },
  },
});
