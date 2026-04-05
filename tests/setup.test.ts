import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('project setup', () => {
  it('package.json has required dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
    expect(pkg.dependencies).toHaveProperty('nuxt')
    expect(pkg.dependencies).toHaveProperty('@ippoan/auth-client')
    expect(pkg.dependencies).toHaveProperty('@nuxtjs/tailwindcss')
  })

  it('nuxt.config.ts contains runtimeConfig', () => {
    const content = readFileSync('nuxt.config.ts', 'utf-8')
    expect(content).toContain('runtimeConfig')
    expect(content).toContain('apiBase')
    expect(content).toContain('authWorkerUrl')
    expect(content).toContain('stagingTenantId')
  })

  it('pages exist', () => {
    const pages = ['app/pages/index.vue', 'app/pages/recipients.vue', 'app/pages/test-distribute.vue']
    for (const page of pages) {
      const content = readFileSync(page, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    }
  })

  it('CI workflow exists', () => {
    const content = readFileSync('.github/workflows/test.yml', 'utf-8')
    expect(content).toContain('ippoan/ci-workflows')
    expect(content).toContain('frontend-ci.yml')
  })
})
