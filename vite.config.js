import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
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
    // Hidden source maps: emitted for error tooling but no sourceMappingURL in
    // the shipped JS, so browsers never fetch them.
    build: { target: 'es2022', sourcemap: 'hidden' },
});
