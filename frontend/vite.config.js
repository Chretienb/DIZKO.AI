import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// NOTE: Storybook/Vitest test config lives in vitest.config.js (dev-only).
// Keep it OUT of this file — Vercel builds with NODE_ENV=production, which
// skips devDependencies, so importing test plugins here breaks the build.
// (@sentry/vite-plugin lives in `dependencies` for exactly this reason.)

export default defineConfig(({ mode }) => {
  // Load all env (incl. non-VITE_ vars) from .env files + real process env, so
  // SENTRY_AUTH_TOKEN works locally (from frontend/.env) and on Vercel (real env).
  // Non-VITE_ vars stay build-only — they never reach the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN;

  // Source maps upload to Sentry on build ONLY when SENTRY_AUTH_TOKEN is set, so
  // prod stack traces map back to real source. Without it (local dev,
  // un-configured builds) this is a no-op and no maps are emitted.
  return {
  build: {
    // Emit source maps only when we're going to upload + delete them.
    sourcemap: sentryAuthToken ? true : false,
  },
  plugins: [
    react(),
    tailwindcss(),
    sentryAuthToken && sentryVitePlugin({
      org: 'dizko',
      project: 'dizko-frontend',
      authToken: sentryAuthToken,
      release: { name: env.VITE_SENTRY_RELEASE || undefined },
      // Upload the maps, then delete them so they're never served publicly.
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ].filter(Boolean),
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
  };
});