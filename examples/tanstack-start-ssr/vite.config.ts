import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackStart(),
    // Nitro's node-server preset writes a standalone Node server to
    // .output/server and the browser assets to .output/public.
    nitro({ preset: 'node-server' }),
    // React's plugin must come after Start's.
    viteReact(),
  ],
});
