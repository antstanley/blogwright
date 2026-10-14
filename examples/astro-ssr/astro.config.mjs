import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // The app sees the Web Function endpoint's domain as Host, so absolute URLs
  // are built from `site` (Astro.site), not Astro.url.
  site: 'https://example.com',
  vite: {
    // Bundle every dependency into dist/server, so the package Blogwright
    // zips is self-contained: Lambda loads nothing outside it.
    ssr: { noExternal: true },
  },
});
