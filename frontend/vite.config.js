import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app talks to the local Node.js API through this proxy,
// so the browser only ever sees http://localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
