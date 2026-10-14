import { defineConfig } from 'astro/config';

// Static output (the default) writes /about as dist/about/index.html, which is
// what Blogwright's router resolves /about to.
export default defineConfig({
  site: 'https://example.com',
});
