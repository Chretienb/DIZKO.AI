import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// NOTE: Storybook/Vitest test config lives in vitest.config.js (dev-only).
// Keep it OUT of this file — Vercel builds with NODE_ENV=production, which
// skips devDependencies, so importing test plugins here breaks the build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Prevent multiple React copies when packages bundle their own React
    dedupe: ['react', 'react-dom', 'react-router-dom']
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // Exports stream many WAVs + zip — allow long-running responses
        timeout: 120000,
        proxyTimeout: 120000,
        rewrite: path => path.replace(/^\/api/, '')
      }
    },
    historyApiFallback: true
  },
  preview: {
    port: 5173
  }
});