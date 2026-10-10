// Scene list for the ad. Each scene has an unrecorded `prepare` (navigate, wait
// for data, place overlays) and a recorded `act` (the motion on camera).
// Order here is the cut order; durations come from copy.json.
import type { Page } from 'playwright';

export type Ratio = 'landscape' | 'vertical';

export const PROJECTS: Record<Ratio, { width: number; height: number; dpr: number; outW: number; outH: number }> = {
  landscape: { width: 1280, height: 720, dpr: 1.5, outW: 1920, outH: 1080 },
  vertical: { width: 540, height: 960, dpr: 2, outW: 1080, outH: 1920 },
};

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

/**
 * Moves a virtual camera over the app: an eased CSS transform on #root.
 * Bounding boxes and the mouse follow the transform, so glides still land.
 */
async function camera(page: Page, transform: string, origin: string, ms: number) {
  await page.evaluate(
    ([transform, origin, ms]) => {
      const root = document.getElementById('root')!;
      root.style.transformOrigin = origin;
      root.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
      root.style.transform = transform;
    },
    [transform, origin, ms] as const,
  );
}

/** Smooth scroll of whichever element scrolls the page content. */
async function smoothScroll(page: Page, dy: number, ms: number) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise<void>((done) => {
        // The app scrolls inside <main>; scrolling the document drags the sidebar off-screen.
        const el =
          ([...document.querySelectorAll('main, main *')] as Element[]).find(
            (c) => c.scrollHeight > c.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(c).overflowY),
          ) ?? document.scrollingElement!;
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
    },
    async act(ctx) {
      // Plan → spaced-repetition ladder → dropped endgames → rating charts.
      await sleep(1300);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 700 : 560, 2600);
      await sleep(900);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 800 : 640, 2800);
    },
  },

  drillScene('training', '00d1e5e6-238e-49b8-b0ba-0b7dcac79fd9', { glideMs: 460 }), // Qh7+! Kxh7 Rh3#

  {
    id: 'openings',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/openings');
    },
    async act(ctx) {
      await sleep(700);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 560 : 360, 2000);
    },
  },

  {
    id: 'endgames',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/endgames');
      await ctx.page.evaluate(() => (window as any).__ad.cursor(true));
    },
    async act(ctx) {
      await sleep(400);
      const due = ctx.page.getByRole('button', { name: /^Due\b/i }).first();
      const box = await due.boundingBox({ timeout: 2000 }).catch(() => null);
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

  drillScene('drill2', '409b8541-1a9d-4c51-9571-65626f1b22f8', { glideMs: 360, preplay: 1 }), // (Qxc6 Qxc6) Ne7+ fork, Nxc6

  {
    // The /training landing's motif filters: push in on the "By pattern" card,
    // sweep a few chips, then pick one and pull back out to its drill.
    id: 'motifs',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/training');
      // Warm-up off camera: open the back-rank drill once so its data and the
      // board chunk are cached, then return to the landing in-app (no reload).
      await ctx.page.getByRole('button', { name: 'Back-rank weakness' }).first().click();
      await ctx.page.locator('cg-board').first().waitFor({ timeout: 15_000 });
      await settle(ctx.page);
      for (const path of ['/dashboard', '/training']) {
        await ctx.page.evaluate((to) => {
          history.pushState({}, '', to);
          dispatchEvent(new PopStateEvent('popstate'));
        }, path);
        await sleep(400);
      }
      await settle(ctx.page);
      const card = ctx.page.locator('section', { hasText: 'By pattern' }).first();
      await card.waitFor({ timeout: 10_000 });
      await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await ctx.page.evaluate(() => (window as any).__ad.cursor(true));
    },
    async act(ctx) {
      const { page, ratio } = ctx;
      const card = page.locator('section', { hasText: 'By pattern' }).first();
      const box = (await card.boundingBox())!;
      const vp = page.viewportSize()!;
      // Scale so the card fills most of the frame, centred above the caption strip.
      const scale = Math.min((vp.width * 0.86) / box.width, (vp.height * 0.6) / box.height, 2.4);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const ty = vp.height * (ratio === 'vertical' ? 0.4 : 0.42) - cy;
      await camera(page, `translate(${vp.width / 2 - cx}px, ${ty}px) scale(${scale})`, `${cx}px ${cy}px`, 1100);
      await sleep(1150);
      // Hover in step with the read: back-rank, then hanging pieces.
      for (const name of ['Back-rank weakness', 'Missed hanging piece']) {
        const chip = await page.getByRole('button', { name }).first().boundingBox();
        if (!chip) continue;
        await glide(page, { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, 600);
        await sleep(300);
      }
      // Pull back before picking: Chessground measures the board when it mounts,
      // so it must not mount under the camera's scale (pieces come out giant).
      await camera(page, 'none', `${cx}px ${cy}px`, 700);
      await sleep(720);
      const pick = await page.getByRole('button', { name: 'Back-rank weakness' }).first().boundingBox();
      if (pick) {
        await glide(page, { x: pick.x + pick.width / 2, y: pick.y + pick.height / 2 }, 450);
        await sleep(120);
        await page.mouse.down();
        await page.mouse.up();
        // The drill opens at the landing's scroll position; bring its board into frame.
        await page.locator('cg-board').first().waitFor({ timeout: 2500 }).catch(() => {});
        await page.evaluate(() => {
          const board = document.querySelector('cg-board');
          // scrollIntoView is stubbed by other scenes' habits; scroll each scrolling ancestor.
          for (let el = board?.parentElement; el; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight) el.scrollTo({ top: 0, behavior: 'smooth' });
          }
          document.scrollingElement?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    },
  },

  cardScene('stats', 'stats'),
  cardScene('testimonials', 'testimonials'),

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
      await sleep(600);
      // Landscape shows the earned grid as-is; scrolling there moves the sidebar too.
      if (ctx.ratio === 'vertical') await smoothScroll(ctx.page, 700, 3000);
    },
  },

  {
    id: 'leaderboard',
    kind: 'app',
    async prepare(ctx) {
      await open(ctx, '/leaderboards');
      await ctx.page.locator('[data-testid="leaderboard-me"]').waitFor({ timeout: 10_000 }).catch(() => {});
    },
    async act(ctx) {
      await sleep(600);
      await smoothScroll(ctx.page, ctx.ratio === 'vertical' ? 200 : 120, 1200);
    },
  },

  cardScene('cta', 'cta'),
];

export { center };
