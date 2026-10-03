import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Chess, type Move } from 'chess.js';
import { useAuth } from '../../auth/useAuth';
import {
  createBoardCanvas,
  drawBoardFrame,
  loadPieceImages,
  loadShareFonts,
  renderBoardPng,
  type BoardFrame,
  type Orientation,
  type PieceImages,
} from '../../share/boardCanvas';
import { renderGif } from '../../share/gif';
import { canShareFiles, downloadBlob, shareOrDownload } from '../../share/shareFile';
import { recordShare } from '../../share/recordShare';
import { inviteUrl } from '../../lib/referral';

/** Morphy's Opera Game — a familiar default so the page never starts empty. */
const EXAMPLE_PGN =
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0';
const EXAMPLE_FROM = 24; // after 12...Rd8
const EXAMPLE_CAPTION = 'Morphy, 1858: the Opera Game finish';

const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 1300 },
  { id: 'normal', label: 'Normal', ms: 850 },
  { id: 'fast', label: 'Fast', ms: 500 },
] as const;
type SpeedId = (typeof SPEEDS)[number]['id'];

const PREVIEW_SIZE = 480;
const MAX_PLIES = 60;

interface Parsed {
  startFen: string;
  moves: Move[];
}

/** PGN, a bare move list, or a FEN (a still image). Null when nothing parses. */
function parseInput(text: string): Parsed | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const fenOnly = new Chess(trimmed);
    return { startFen: fenOnly.fen(), moves: [] };
  } catch {
    // not a FEN
  }
  try {
    const chess = new Chess();
    chess.loadPgn(trimmed);
    const moves = chess.history({ verbose: true });
    const startFen = moves[0]?.before ?? chess.fen();
    return { startFen, moves };
  } catch {
    return null;
  }
}

function moveLabel(parsed: Parsed, ply: number): string {
  if (ply === 0) return 'Start';
  const m = parsed.moves[ply - 1];
  const fields = parsed.startFen.split(' ');
  const startMove = Number(fields[5]) || 1;
  const offset = fields[1] === 'b' ? 1 : 0;
  const moveNo = startMove + Math.floor((ply - 1 + offset) / 2);
  return `${moveNo}${m.color === 'w' ? '.' : '...'} ${m.san}`;
}

function framesFor(parsed: Parsed, from: number, to: number): BoardFrame[] {
  const frames: BoardFrame[] = [];
  for (let ply = from; ply <= to; ply++) {
    if (ply === 0) frames.push({ fen: parsed.startFen, lastMove: null });
    else {
      const m = parsed.moves[ply - 1];
      frames.push({ fen: m.after, lastMove: [m.from, m.to] });
    }
  }
  return frames;
}

/**
 * Turn a move sequence into a branded GIF: paste a game, pick the moves,
 * preview it live (drawn by the same canvas renderer the export uses), then
 * download or share.
 */
export function MomentsTool() {
  const { session, refreshProfile, profile } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const deepLink = (location.state as { pgn?: string; from?: number; to?: number; orientation?: Orientation } | null) ?? null;
  const initialPgn = deepLink?.pgn ?? params.get('pgn') ?? EXAMPLE_PGN;
  const usingExample = initialPgn === EXAMPLE_PGN;

  const [text, setText] = useState(initialPgn);
  const parsed = useMemo(() => parseInput(text), [text]);
  const total = parsed?.moves.length ?? 0;
  const [from, setFrom] = useState(() => deepLink?.from ?? Number(params.get('from') ?? (usingExample ? EXAMPLE_FROM : 0)));
  const [to, setTo] = useState(() => deepLink?.to ?? Number(params.get('to') ?? Number.MAX_SAFE_INTEGER));
  const [orientation, setOrientation] = useState<Orientation>(
    deepLink?.orientation ?? (params.get('orientation') === 'black' ? 'black' : 'white'),
  );
  const [caption, setCaption] = useState(usingExample ? EXAMPLE_CAPTION : '');
  const [speed, setSpeed] = useState<SpeedId>('normal');
  const [busy, setBusy] = useState<'gif' | 'png' | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [pieces, setPieces] = useState<PieceImages | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Keep the range valid as the input changes.
  const start = Math.max(0, Math.min(from, total));
  const end = Math.max(start, Math.min(to, total, start + MAX_PLIES));
  const frames = useMemo(() => (parsed ? framesFor(parsed, start, end) : []), [parsed, start, end]);
  const frameMs = SPEEDS.find((s) => s.id === speed)!.ms;
  const opts = useMemo(
    () => ({ size: PREVIEW_SIZE, orientation, caption: caption.trim() || null }),
    [orientation, caption],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadPieceImages(), loadShareFonts()]).then(([p]) => {
      if (!cancelled) setPieces(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live preview loops through the selected frames with the export's timing.
  useEffect(() => {
    setFrameIdx(0);
    if (frames.length <= 1) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const last = i === frames.length - 1;
      timer = setTimeout(
        () => {
          i = (i + 1) % frames.length;
          setFrameIdx(i);
          tick();
        },
        i === 0 || last ? 1600 : frameMs,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, [frames, frameMs]);

  useEffect(() => {
    if (!pieces || !canvasHost.current || frames.length === 0) return;
    const canvas = createBoardCanvas(opts, Math.min(2, window.devicePixelRatio || 1));
    canvas.className = 'block w-full h-auto';
    canvas.setAttribute('data-testid', 'moments-preview');
    if (canvasRef.current) canvasRef.current.replaceWith(canvas);
    else canvasHost.current.appendChild(canvas);
    canvasRef.current = canvas;
    drawBoardFrame(canvas, frames[Math.min(frameIdx, frames.length - 1)], opts, pieces);
  }, [pieces, frames, frameIdx, opts]);

  const shareUrl = inviteUrl(profile?.referralCode, '/moments');
  const filenameBase = `patternchess-moment-${Date.now().toString(36)}`;

  const exportGif = async (mode: 'download' | 'share') => {
    if (frames.length === 0) return;
    setBusy('gif');
    try {
      // Exported larger than the on-screen preview so it stays crisp on retina screens.
      const blob = await renderGif(frames, { ...opts, size: 640, frameMs });
      if (mode === 'share') {
        const outcome = await shareOrDownload({
          blob,
          filename: `${filenameBase}.gif`,
          title: caption || 'A chess moment',
          text: caption || 'A chess moment, made with PatternChess.',
          url: shareUrl,
        });
        if (outcome !== 'cancelled') recordShare(!!session, refreshProfile);
      } else {
        downloadBlob(blob, `${filenameBase}.gif`);
        recordShare(!!session, refreshProfile);
      }
    } finally {
      setBusy(null);
    }
  };

  const exportPng = async () => {
    const frame = frames[Math.min(frameIdx, frames.length - 1)];
    if (!frame) return;
    setBusy('png');
    try {
      downloadBlob(await renderBoardPng(frame, { ...opts, size: 640 }), `${filenameBase}.png`);
      recordShare(!!session, refreshProfile);
    } finally {
      setBusy(null);
    }
  };

  const plyOptions = Array.from({ length: total + 1 }, (_, ply) => ply);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div
          ref={canvasHost}
          className="w-full border-2 border-text-primary bg-surface-3"
          style={{ aspectRatio: `${PREVIEW_SIZE} / ${PREVIEW_SIZE + (opts.caption ? 48 : 0) + 51}` }}
        />
        <p className="text-text-primary text-sm">
          {frames.length > 1
            ? `${frames.length - 1} ${frames.length === 2 ? 'move' : 'moves'}, ${moveLabel(parsed!, start)} to ${moveLabel(parsed!, end)}`
            : 'A still position. Add moves to animate it.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {canShareFiles() && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy != null || frames.length < 2}
              onClick={() => void exportGif('share')}
            >
              Share GIF
            </button>
          )}
          <button
            type="button"
            className={canShareFiles() ? 'btn-outline' : 'btn-primary'}
            disabled={busy != null || frames.length < 2}
            data-testid="moments-download-gif"
            onClick={() => void exportGif('download')}
          >
            {busy === 'gif' ? 'Making GIF…' : 'Download GIF'}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={busy != null || frames.length === 0}
            data-testid="moments-download-png"
            onClick={() => void exportPng()}
          >
            {busy === 'png' ? 'Saving…' : 'Screenshot this frame'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="label">Game (PGN, moves, or a FEN)</span>
          <textarea
            className="input min-h-[8rem] font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            spellCheck={false}
            data-testid="moments-input"
            aria-invalid={!parsed}
          />
          {!parsed && (
            <span className="text-incorrect text-sm" role="alert">
              That doesn't read as a PGN, a move list or a FEN.
            </span>
          )}
        </label>

        {total > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">From</span>
              <select
                className="input"
                value={start}
                data-testid="moments-from"
                onChange={(e) => setFrom(Number(e.currentTarget.value))}
              >
                {plyOptions.slice(0, -1).map((ply) => (
                  <option key={ply} value={ply}>
                    {ply === 0 ? 'Start position' : `After ${moveLabel(parsed!, ply)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">To</span>
              <select
                className="input"
                value={end}
                data-testid="moments-to"
                onChange={(e) => setTo(Number(e.currentTarget.value))}
              >
                {plyOptions
                  .filter((ply) => ply > start && ply <= start + MAX_PLIES)
                  .map((ply) => (
                    <option key={ply} value={ply}>
                      {moveLabel(parsed!, ply)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="label">Caption (optional)</span>
          <input
            className="input"
            maxLength={60}
            value={caption}
            placeholder="e.g. My first queen sacrifice"
            onChange={(e) => setCaption(e.currentTarget.value)}
          />
        </label>

        <div className="flex flex-wrap gap-6">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label mb-1.5">Board</legend>
            <div className="flex gap-1.5">
              {(['white', 'black'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={orientation === o}
                  onClick={() => setOrientation(o)}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-mono uppercase tracking-tight border-2 border-text-primary rounded-none',
                    orientation === o ? 'bg-text-primary text-bg' : 'bg-surface text-text-primary hover:bg-accent/15',
                  )}
                >
                  {o === 'white' ? 'White below' : 'Black below'}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label mb-1.5">Speed</legend>
            <div className="flex gap-1.5">
              {SPEEDS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={speed === s.id}
                  onClick={() => setSpeed(s.id)}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-mono uppercase tracking-tight border-2 border-text-primary rounded-none',
                    speed === s.id ? 'bg-text-primary text-bg' : 'bg-surface text-text-primary hover:bg-accent/15',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
