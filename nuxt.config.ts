// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxtjs/tailwindcss'],

  nitro: {
    preset: 'cloudflare_module',
  },

  // @ippoan/auth-client/server (createIdentityProxyHandler) を Nitro が transpile
  // できるよう指定。.vue / .mjs ソースをそのまま ship するため必要。
  build: {
    transpile: ['@ippoan/auth-client'],
  },

  runtimeConfig: {
    // server-only: /api/proxy が転送する rust-alc-api backend URL。
    // wrangler.jsonc の NUXT_ALC_API_URL から注入される。
    alcApiUrl: process.env.NUXT_ALC_API_URL || 'https://alc-api.ippoan.org',
    public: {
      apiBase: 'http://localhost:8080',
      authWorkerUrl: 'https://auth.ippoan.org',
      stagingTenantId: '',
      // notify-realtime-bus Worker (DurableObject + hibernated WS) の URL。
      // 未設定なら useRedactionWatch は no-op (既存 polling が UI 更新を担う)。
      // 本番: wss://realtime.notify.ippoan.org / staging: wss://realtime.notify-staging.ippoan.org
      realtimeBusUrl: '',
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