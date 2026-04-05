import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'app'),
    },
  },
  test: {
    environment: 'node',
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
