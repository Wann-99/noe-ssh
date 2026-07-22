import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // shared/ has both .ts (client) and .js (Node); prefer TypeScript ESM for Vite.
    extensions: ['.mjs', '.ts', '.tsx', '.js', '.json'],
    alias: {
      // Prefer .ts mirrors; bare @shared/* would resolve to CommonJS .js and break Vite/Rollup named exports.
      '@shared/protocol': path.resolve(__dirname, '../shared/protocol.ts'),
      '@shared/wsBinary': path.resolve(__dirname, '../shared/wsBinary.ts'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'zustand'],
          'terminal-vendor': [
            '@xterm/xterm',
            '@xterm/addon-fit',
            '@xterm/addon-search',
            '@xterm/addon-web-links',
          ],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
});
