import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'blogwright-pds': fileURLToPath(new URL('../pds/src/index.ts', import.meta.url)),
      'blogwright-core/rkey': fileURLToPath(new URL('../core/src/rkey.ts', import.meta.url)),
      'blogwright-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
