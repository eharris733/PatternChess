// Dev twin of functions/api/book.ts, mounted by vite.config. Serves /api/book
// from the local builder output (data/book/work.sqlite, `book` table) when it
// exists, so the book can be tested before any D1 import; otherwise forwards
// to production. The wire format comes from src/chess/bookFormat.ts, loaded
// through Vite so the dev and prod handlers can't drift.

import { existsSync } from 'node:fs';
import path from 'node:path';

const PROD_ORIGIN = 'https://patternchess.com';

/** @param {{ root: string }} cfg */
export function devBookProxy(cfg) {
  const dbPath = path.join(cfg.root, 'data/book/work.sqlite');
  let db = null;

  async function openLocal() {
    if (db || !existsSync(dbPath)) return db;
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    return db;
  }

  return {
    name: 'dev-book-proxy',
    configureServer(server) {
      server.middlewares.use('/api/book', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(typeof body === 'string' ? body : JSON.stringify(body));
        };
        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          const local = await openLocal();

          if (!local) {
            const upstream = await fetch(`${PROD_ORIGIN}/api/book`, {
              method: req.method,
              headers: { 'Content-Type': 'application/json' },
              body: req.method === 'POST' ? raw : undefined,
            });
            return send(upstream.status, await upstream.text());
          }
          if (req.method !== 'POST') return send(200, { source: 'local', db: dbPath });

          const fmt = await server.ssrLoadModule('/src/chess/bookFormat.ts');
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            return send(400, { error: 'bad json' });
          }
          const fens = fmt.parseBookRequest(body);
          if (typeof fens === 'string') return send(400, { error: fens });
          const stmt = local.prepare('SELECT tier, w, d, b, cp, depth, moves FROM book WHERE epd = ?');
          const positions = {};
          for (const epd of new Set(fens.map(fmt.bookEpd))) {
            const row = fmt.pickTier(stmt.all(epd));
            if (row) positions[epd] = fmt.rowToPosition(row);
          }
          return send(200, { positions });
        } catch (err) {
          return send(502, { error: String(err) });
        }
      });
    },
  };
}
