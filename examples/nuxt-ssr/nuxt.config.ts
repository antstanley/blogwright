export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // The default preset: a standalone Node server in .output/server.
  nitro: { preset: 'node-server' },
  app: {
    head: { link: [{ rel: 'icon', href: '/favicon.svg' }] },
  },
});
