import { defineConfig } from 'vitest/config';

// Percorsi relativi (base './'): l'app funziona sotto /GT-Pdf/ su GitHub Pages e in locale.
// BUILD_ID identifica la versione caricata (la cache di Safari puo' servire file vecchi).
const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'safari16',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
