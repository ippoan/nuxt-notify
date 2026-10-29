import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
// .vue を mount するテスト (tests/components) 用。@vitejs/plugin-vue は Nuxt が入れるもの
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'app'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'workers/**'],
    coverage: {
      provider: 'v8',
      include: ['app/composables/**/*.ts', 'app/utils/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
