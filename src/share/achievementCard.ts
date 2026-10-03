/** 1200×630 branded "Achievement unlocked" card (Open Graph proportions). */
import {
  GOLD_DARK,
  GOLD_LIGHT,
  SITE_LABEL,
  readShareTheme,
  canvasToBlob,
  drawBrandMark,
  drawFooter,
  loadShareFonts,
} from './boardCanvas';

const W = 1200;
const H = 630;
const FOOTER = 90;
const MONO = '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace';
const SANS = 'Inter, "Inter Fallback", system-ui, sans-serif';

export interface AchievementCardInput {
  title: string;
  description: string;
  categoryLabel: string;
  /** Player label (handle or first name); omitted when unknown. */
  playerLabel?: string | null;
  /** Flair title shown next to the player label. */
  flairTitle?: string | null;
}

/** Word-wraps `text` into at most `maxLines` lines that fit `maxWidth`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

export async function renderAchievementCard(input: AchievementCardInput): Promise<Blob> {
  await loadShareFonts();
  const scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const theme = readShareTheme();
  const INK = theme.ink;
  const PAPER = theme.paper;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Left panel: a quiet board pattern behind the big brand mark.
  const panel = H - FOOTER;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, panel, panel);
  const cell = panel / 8;
  ctx.fillStyle = 'rgba(244, 244, 240, 0.05)';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 0) ctx.fillRect(c * cell, r * cell, cell, cell);
  drawBrandMark(ctx, panel * 0.2, panel * 0.2, panel * 0.6);

  // Right: copy.
  const x = panel + 64;
  const maxW = W - x - 64;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = GOLD_DARK;
  ctx.font = `700 26px ${MONO}`;
  ctx.fillText('ACHIEVEMENT UNLOCKED', x, 130);

  ctx.fillStyle = INK;
  ctx.font = `800 76px ${SANS}`;
  const titleLines = wrap(ctx, input.title, maxW, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, x, 220 + i * 84));
  let y = 220 + (titleLines.length - 1) * 84 + 64;

  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.85;
  ctx.font = `400 32px ${SANS}`;
  for (const l of wrap(ctx, input.description, maxW, 3)) {
    ctx.fillText(l, x, y);
    y += 44;
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.fillRect(x, H - FOOTER - 92, 60, 4);
  ctx.font = `700 24px ${MONO}`;
  const who = [input.playerLabel, input.flairTitle].filter(Boolean).join(' · ');
  ctx.fillText(who ? who.toUpperCase() : input.categoryLabel.toUpperCase(), x, H - FOOTER - 48);
  if (who) {
    ctx.fillStyle = GOLD_LIGHT;
    ctx.textAlign = 'right';
    ctx.fillText(input.categoryLabel.toUpperCase(), W - 64, H - FOOTER - 48);
    ctx.textAlign = 'left';
  }

  drawFooter(ctx, H - FOOTER, W, FOOTER, `TRAIN YOUR BLUNDERS · ${SITE_LABEL}`, theme);
  return canvasToBlob(canvas);
}
