import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root so frontend and backend share one file.
  // Only variables starting with VITE_ are ever exposed to the browser.
  envDir: '..',
  server: {
    port: 5173,
    // shared/ (one folder up) holds data used by both the frontend and the backend.
    fs: { allow: ['..'] },
    // Forward /api/* to the FastAPI backend so the browser only talks to one origin.
    // `ws: true` also forwards the speech-to-text WebSocket.
    proxy: { '/api': { target: 'http://localhost:8000', ws: true } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
