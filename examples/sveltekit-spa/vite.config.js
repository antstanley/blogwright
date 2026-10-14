import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      // One shell page for every route. Blogwright's `spa: true` answers any
      // path with no object in S3 with /index.html, so the fallback must be
      // index.html.
      adapter: adapter({ fallback: 'index.html' }),
    }),
  ],
});
