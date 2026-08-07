import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleJSON = JSON.parse(readFileSync(new URL('./module.json', import.meta.url), 'utf8'));
const id = moduleJSON.id;

const FOUNDRY = 'http://localhost:30000';

/**
 * `module.json` points Foundry at build output that doesn't exist in dev. Both requests are
 * answered in place rather than by proxying the dev server back to itself: a self-proxy target
 * has to name a port, and the port moves the moment a sibling module's dev server has taken
 * 30001 — the request then lands on *that* module's server and 404s.
 */
const foundryDevEntry = (): Plugin => ({
  name: 'foundry-dev-entry',
  configureServer(server) {
    const js = `/modules/${id}/dist/${id}.js`;
    const css = `/modules/${id}/dist/${id}.css`;
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      // `base` maps /modules/<id>/dist/ onto root `src/`, so this resolves to src/index.ts.
      if (path === js) req.url = `/modules/${id}/dist/index.ts`;
      else if (path === css) {
        // The real styles arrive through the JS import; Foundry just needs a 200 here.
        res.setHeader('content-type', 'text/css');
        res.end('');
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  root: 'src/',
  base: `/modules/${id}/dist/`,
  // root is src/, so point the plugin at the repo-root config (shared with svelte-check).
  plugins: [
    svelte({ configFile: fileURLToPath(new URL('./svelte.config.ts', import.meta.url)) }),
    foundryDevEntry(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // `npm run dev` runs this as a reverse proxy in front of Foundry: open the /game URL on the
  // port Vite prints (NOT :30000 — and not necessarily 30001, which a sibling module's dev
  // server may already hold) and Vite serves our module's source with HMR while proxying
  // everything else — Foundry routes, the socket, our static files — to the real server on
  // :30000. Ignored by `vite build`.
  server: {
    port: 30001,
    open: '/game',
    proxy: {
      // Our static files live on disk under the module, not in Vite's src/ root — Foundry serves them.
      [`^/modules/${id}/(lang|packs|assets)/`]: FOUNDRY,
      // Everything outside our module (Foundry core, the active system, other modules).
      [`^(?!/modules/${id}/)`]: FOUNDRY,
      '/socket.io': { target: 'ws://localhost:30000', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2022',
    lib: {
      entry: './index.ts',
      formats: ['es'],
      fileName: () => `${id}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => {
          const name = asset.name ?? asset.names?.[0] ?? '';
          return name.endsWith('.css') ? `${id}.css` : '[name][extname]';
        },
      },
    },
  },
});
