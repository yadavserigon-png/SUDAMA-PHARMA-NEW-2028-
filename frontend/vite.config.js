import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :5000 and is proxied, so the browser only talks to :5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
