import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      next();
    });
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), crossOriginIsolation],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['chessground'] },
  build: { target: 'es2022' },
});
