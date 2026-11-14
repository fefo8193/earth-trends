import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { packData } from './scripts/pack_data.mjs';

export default defineConfig(async ({ command }) => {
  if (command === 'build') await packData({ quiet: true });
  return {
  // Rutas relativas: funciona igual en GitHub Pages (/earth-trends/), Netlify o localhost
  base: './',
  plugins: [react()],
  // three/webgpu (usado por globe.gl) tiene top-level await
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  };
});
