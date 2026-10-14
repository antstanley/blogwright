import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      // Every page is prerendered to build/. The 404.html fallback is the page
      // Blogwright's distribution answers misses with (status 404).
      adapter: adapter({ fallback: '404.html' }),
    }),
  ],
});
