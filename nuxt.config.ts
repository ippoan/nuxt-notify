// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxtjs/tailwindcss'],

  nitro: {
    preset: 'cloudflare_module',
  },

  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:8080',
      authWorkerUrl: 'https://auth.ippoan.org',
      stagingTenantId: '',
    },
  },

  vite: {
    server: {
      // wt-quick (cloudflared trycloudflare.com) 経由のアクセスを許可
      allowedHosts: ['.trycloudflare.com'],
    },
    optimizeDeps: {
      // @ippoan/auth-client を Vite pre-bundle すると useRuntimeConfig 等の
      // 重複 import で不正 JS になる。除外して通常 ESM 解決に任せる。
      exclude: ['@ippoan/auth-client'],
    },
  },
})