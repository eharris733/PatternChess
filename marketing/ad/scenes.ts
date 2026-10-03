// Scene list for the ad. Each scene has an unrecorded `prepare` (navigate, wait
// for data, place overlays) and a recorded `act` (the motion on camera).
// Order here is the cut order; durations come from copy.json.
import type { Page } from 'playwright';

export type Ratio = 'landscape' | 'vertical';

export interface SceneCtx {
  page: Page;
  ratio: Ratio;
  copy: any;
  stats: any;
  seconds: number;
  /** Fetches a blunder row by id (service key, read-only). */
  blunder(id: string): Promise<any>;
  baseUrl: string;
}

export interface Scene {
  id: string;
  kind: 'card' | 'app';
  prepare(ctx: SceneCtx): Promise<void>;
  act(ctx: SceneCtx): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loads a route and waits until skeletons/spinners are gone. */
async function open(ctx: SceneCtx, path: string) {
  await ctx.page.goto(ctx.baseUrl + path);
  await settle(ctx.page);
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('main .animate-pulse, main [aria-busy="true"]'), null, { timeout: 12_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // Wake the site's sound context (installSoundUnlock listens for the first
  // pointerdown) so the first move sound on camera isn't swallowed.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown')));
  await sleep(600);
}

function caption(ctx: SceneCtx, key: string, pos: 'bottom' | 'right' = 'bottom') {
  return ctx.page.evaluate(
    ([text, ratio, slot, p]) => (window as any).__ad.caption(text, ratio, slot, p),
    [ctx.copy.captions[key], ctx.ratio, `captions.${key}`, pos],
  );
}

function card(ctx: SceneCtx, name: string) {
  return ctx.page.evaluate(
    ([n, data]) => (window as any).__ad.card(n, data),
    [name, { copy: ctx.copy, stats: ctx.stats, ratio: ctx.ratio, seconds: ctx.seconds }] as const,
  );
}

/** Eased cursor glide (the overlay draws the cursor; headless has none). */
async function glide(page: Page, to: { x: number; y: number }, ms = 600) {
  const from = await page.evaluate(() => (window as any).__adPos ?? { x: innerWidth * 0.62, y: innerHeight * 0.75 });
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
  await page.evaluate((pos) => ((window as any).__adPos = pos), to);
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Smooth scroll of whichever element scrolls the page content. */
async function smoothScroll(page: Page, dy: number, ms: number) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise<void>((done) => {
        const candidates = [document.scrollingElement, ...document.querySelectorAll('main, main *')] as Element[];
        const el =
          candidates.find((c) => c && c.scrollHeight > c.clientHeight + 40 && getComputedStyle(c).overflowY !== 'hidden' &&
            (c === document.scrollingElement || /auto|scroll/.test(getComputedStyle(c).overflowY))) ?? document.scrollingElement!;
        const start = el.scrollTop;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          el.scrollTop = start + dy * e;
          if (p < 1) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      }),
    [dy, ms] as const,
  );
}

/** Drag a piece square→square (white orientation), with the drawn cursor. */
async function dragMove(page: Page, from: string, to: string, ms = 520) {
  const board = await page.locator('cg-board').first().boundingBox();
  if (!board) throw new Error('no board');
  const sq = board.width / 8;
  const px = (s: string) => ({
    x: board.x + sq * (s.charCodeAt(0) - 97) + sq / 2,
    y: board.y + sq * (8 - Number(s[1])) + sq / 2,
  });
  const a = px(from);
  const b = px(to);
  await glide(page, a, ms);
  await page.mouse.down();
  await sleep(110);
  await glide(page, b, ms);
  await page.mouse.up();
}

/**
 * A real drill from the account's games, served as the only due item so the
 * position on camera is known. Plays the solution's user moves (pv[0], pv[2],
 * …) until the app reports the solution, with the drawn cursor.
 */
function drillScene(
  id: string,
  blunderId: string,
  captionKey: string | null,
  opts: { glideMs?: number; preplay?: number } = {},
): Scene {
  const glideMs = opts.glideMs ?? 520;
  let row: any;
  return {
    id,
    kind: 'app',
    async prepare(ctx) {
      row = { ...(await ctx.blunder(blunderId)), next_drill_at: new Date(Date.now() - 3600_000).toISOString() };
      await ctx.page.route(/\/rest\/v1\/blunders\?.*next_drill_at=lte/, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) })
          : route.fallback(),
      );
      await open(ctx, '/training');
      await ctx.page.getByRole('button', { name: /Review \d+ positions?/ }).click();
      await ctx.page.locator('cg-board').first().waitFor();
      await ctx.page.locator('cg-board').first().scrollIntoViewIfNeeded();
      await settle(ctx.page);
      // Optionally play the opening user moves off-camera, so a short clip
      // starts at the interesting part of the line.
      if (opts.preplay) {
        await playUserMoves(ctx.page, row.solution_line?.pv ?? [], 0, opts.preplay, 300);
        await sleep(500);
      }
      if (captionKey) await caption(ctx, captionKey, 'right');
      await ctx.page.evaluate(() => (window as any).__ad.cursor(true));
    },
    async act(ctx) {
      await sleep(glideMs < 500 ? 150 : 900);
      await playUserMoves(ctx.page, row.solution_line?.pv ?? [], opts.preplay ?? 0, 99, glideMs);
      const vp = ctx.page.viewportSize()!;
      await glide(ctx.page, { x: vp.width * 0.85, y: 40 }, 700);
    },
  };
}

/** Plays `count` user moves of a drill line (pv[2k]) starting at user move `from`. */
async function playUserMoves(page: Page, pv: string[], from: number, count: number, glideMs: number) {
  const solved = page.getByText(/Solution correct/i).first();
  for (let k = from; k < from + count && 2 * k < pv.length; k++) {
    const i = 2 * k;
    {
      if (await solved.isVisible()) break;
      await dragMove(page, pv[i].slice(0, 2), pv[i].slice(2, 4), glideMs);
      // Wait for the opponent's reply (next prompt) or the solved state.
      await page
        .getByText(new RegExp(`Move ${k + 2} of|Solution correct`, 'i'))
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {});
      await sleep(glideMs < 500 ? 120 : 650);
    }
  }
}

const cardScene = (id: string, cardName: string): Scene => ({
  id,
  kind: 'card',
  async prepare(ctx) {
    await open(ctx, '/learn');
    await card(ctx, cardName);
    await sleep(300);
  },
  async act() {},
});

export const SCENES: Scene[] = [
  cardScene('hook', 'hook'),

  {
    id: 'dashboard',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/dashboard');
      await caption(ctx, 'dashboard');
    },
    async act(ctx) {
      await sleep(1300);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 620 : 520, 2000);
    },
  },

  drillScene('training', '00d1e5e6-238e-49b8-b0ba-0b7dcac79fd9', 'training'), // Qh7+! Kxh7 Rh3#
  drillScene('drill2', '409b8541-1a9d-4c51-9571-65626f1b22f8', null, { glideMs: 360, preplay: 1 }), // (Qxc6 Qxc6) Ne7+ fork, Nxc6

  {
    id: 'openings',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/openings');
      await caption(ctx, 'openings');
    },
    async act(ctx) {
      await sleep(500);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 560 : 360, 1600);
    },
  },

  {
    id: 'openingsReview',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/openings');
      const href = await ctx.page.locator('a[href*="/openings/review/"]').first().getAttribute('href');
      if (!href) throw new Error('no opening review link');
      await open(ctx, href);
      // Time the autoplay once, then replay and start recording near its end
      // so the clip shows the last few moves and the theory/played arrows.
      const replay = ctx.page.getByRole('button', { name: 'Replay' });
      await replay.waitFor({ timeout: 30_000 });
      await caption(ctx, 'openingsReview', 'right');
      // The move list scrolls its active move into view, which drags the
      // board off-screen on camera; pin the page at the top instead.
      await ctx.page.evaluate(() => {
        Element.prototype.scrollIntoView = function () {};
        window.scrollTo(0, 0);
        const pin = () => {
          if (window.scrollY) window.scrollTo(0, 0);
          for (const el of document.querySelectorAll('main, main *')) if (el.scrollTop && !el.closest('nav, ol, ul, table')) el.scrollTop = 0;
          requestAnimationFrame(pin);
        };
        pin();
      });
      // Time one dry replay, then replay again and start recording so the
      // clip ends on the exit with the theory/played arrows.
      // Replay and "Skip to the exit" swap while autoplay runs.
      const skip = ctx.page.getByTestId('skip-replay');
      await replay.click();
      await skip.waitFor();
      const t1 = Date.now();
      await skip.waitFor({ state: 'detached', timeout: 30_000 });
      const replayMs = Date.now() - t1;
      console.log(`  replay takes ${(replayMs / 1000).toFixed(1)}s`);
      await replay.click();
      await skip.waitFor();
      await sleep(Math.max(0, replayMs - (ctx.seconds - 1.4) * 1000));
    },
    async act() {},
  },

  {
    id: 'endgames',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/endgames');
      await caption(ctx, 'endgames');
      await ctx.page.evaluate(() => (window as any).__ad.cursor(true));
    },
    async act(ctx) {
      await sleep(400);
      const rescued = ctx.page.getByRole('button', { name: /Rescued/i }).first();
      const box = await rescued.boundingBox();
      if (box) {
        await glide(ctx.page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 800);
        await sleep(150);
        await ctx.page.mouse.down();
        await ctx.page.mouse.up();
      }
      await sleep(400);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 420 : 260, 1200);
    },
  },

  cardScene('stats', 'stats'),
  cardScene('testimonials', 'testimonials'),

  {
    id: 'leaderboard',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/achievements?tab=leaderboards');
      await ctx.page.locator('[data-testid="leaderboard-me"]').waitFor({ timeout: 10_000 }).catch(() => {});
      await caption(ctx, 'leaderboard');
    },
    async act(ctx) {
      await sleep(600);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 200 : 120, 1200);
    },
  },

  {
    id: 'achievements',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/achievements');
    },
    async act(ctx) {
      // The site's own unlock fanfare (src/lib/sounds.ts, same module instance the app uses).
      await ctx.page.evaluate(async () => {
        const sounds = await import('/src/lib/sounds.ts' as string);
        sounds.playSound('achievement');
      });
      await sleep(300);
      // Landscape shows the earned grid as-is; scrolling there moves the sidebar too.
      if (ctx.ratio === 'vertical') await smoothScroll(ctx.page, 600, 1800);
    },
  },

  cardScene('cta', 'cta'),
];

export { center };
