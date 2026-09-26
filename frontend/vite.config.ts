import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root so frontend and backend share one file.
  // Only variables starting with VITE_ are ever exposed to the browser.
  envDir: '..',
  server: {
    port: 5173,
    // Forward /api/* to the FastAPI backend so the browser only talks to one origin.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
