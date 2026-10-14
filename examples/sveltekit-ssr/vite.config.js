import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      paths: {
        // The app sees the Web Function endpoint's domain as Host, so form
        // actions need the public origin to pass SvelteKit's CSRF check.
        origin: 'https://example.com',
      },
    }),
  ],
});
