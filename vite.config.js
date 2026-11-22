import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { devBookProxy } from './scripts/devBookProxy.mjs';
var crossOriginIsolation = {
    name: 'cross-origin-isolation',
    configureServer: function (server) {
        server.middlewares.use(function (_req, res, next) {
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            next();
        });
    },
    configurePreviewServer: function (server) {
        server.middlewares.use(function (_req, res, next) {
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            next();
        });
    },
};
export default defineConfig(function () {
    return {
        plugins: [
            react(),
            crossOriginIsolation,
            devBookProxy({ root: process.cwd() }),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src'),
            },
        },
        server: {
            port: 5173,
            // Pages Functions don't run under Vite: forward auth + RPC to
            // `wrangler pages dev` on :8788 (see CLAUDE.md). The Host header is kept
            // (no changeOrigin) so better-auth builds localhost:5173 URLs and cookies.
            proxy: {
                '/api/auth': { target: 'http://localhost:8788' },
                '/api/rpc': { target: 'http://localhost:8788' },
                '/api/stripe': { target: 'http://localhost:8788' },
                '/api/articles': { target: 'http://localhost:8788' },
            },
        },
        preview: { port: 4173 },
        worker: { format: 'es' },
        assetsInclude: ['**/*.wasm'],
        optimizeDeps: { exclude: ['chessground'] },
        // Hidden source maps: emitted for error tooling but no sourceMappingURL in
        // the shipped JS, so browsers never fetch them.
        build: { target: 'es2022', sourcemap: 'hidden' },
    };
});
