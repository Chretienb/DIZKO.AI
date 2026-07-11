/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Fast jsdom unit/smoke tests (separate from the Storybook browser-mode config
// in vitest.config.js). Run with: npm test
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
})
