/**
 * Vite's half of the dashboard build. SvelteKit's plugin does the rest, and
 * reads `svelte.config.js` from the working directory - which is why the
 * package's `build` script enters this directory before running `vite build`
 * rather than pointing Vite at it from the package root.
 */

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [sveltekit()] });
