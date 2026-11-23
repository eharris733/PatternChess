import type { ReactNode } from 'react';
import { usePieceSetStore } from '../../state/pieceSetStore';
import { usePieceImages } from '../../hooks/usePieceImages';

/**
 * Small static pictures of what each /profile training setting does, drawn
 * on the player's own board colours and piece set. Each takes the setting's
 * current value, so flipping the switch flips the picture.
 */

const SQ = 20;
const COLS = 4;
const ROWS = 3;

type Cell = [col: number, row: number];

interface MiniProps {
  pieces: Array<{ at: Cell; key: string; faded?: boolean }>;
  arrows?: Array<{ from: Cell; to: Cell; color: string; dashed?: boolean }>;
  children?: ReactNode;
}

function centre([c, r]: Cell): [number, number] {
  return [c * SQ + SQ / 2, r * SQ + SQ / 2];
}

/** A 4×3 board crop with pieces and arrows; `children` draw over the right-hand panel (x ≥ 84). */
function MiniScene({ pieces, arrows = [], children }: MiniProps) {
  const set = usePieceSetStore((s) => s.pieceSet);
  const srcs = usePieceImages(set);
  return (
    <svg viewBox="0 0 160 60" className="h-auto w-full" aria-hidden>
      <defs>
        {arrows.map((a, i) => (
          <marker key={i} id={`pref-arrow-${a.color.replace(/[^a-z0-9]/gi, '')}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill={a.color} />
          </marker>
        ))}
      </defs>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        return (
          <rect
            key={i}
            x={c * SQ}
            y={r * SQ}
            width={SQ}
            height={SQ}
            style={{ fill: (c + r) % 2 === 0 ? 'var(--board-light)' : 'var(--board-dark)' }}
          />
        );
      })}
      {pieces.map((p, i) =>
        srcs?.[p.key] ? (
          <image
            key={i}
            href={srcs[p.key]}
            x={p.at[0] * SQ}
            y={p.at[1] * SQ}
            width={SQ}
            height={SQ}
            opacity={p.faded ? 0.35 : 1}
          />
        ) : null,
      )}
      {arrows.map((a, i) => {
        const [x1, y1] = centre(a.from);
        const [x2, y2] = centre(a.to);
        const k = 0.72;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x1 + (x2 - x1) * k}
            y2={y1 + (y2 - y1) * k}
            stroke={a.color}
            strokeWidth={4}
            strokeOpacity={0.85}
            strokeDasharray={a.dashed ? '3 3' : undefined}
            markerEnd={`url(#pref-arrow-${a.color.replace(/[^a-z0-9]/gi, '')})`}
          />
        );
      })}
      <rect x={COLS * SQ} y={0} width={160 - COLS * SQ} height={60} style={{ fill: 'rgb(var(--surface-3))' }} />
      {children}
    </svg>
  );
}

const INK = 'rgb(var(--text-primary))';
const GREEN = '#15781B';
const RED = '#C42820';

function Chip({ x, y, w, text, fill = INK, color = 'rgb(var(--surface))' }: { x: number; y: number; w: number; text: string; fill?: string; color?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={13} style={{ fill }} />
      <text x={x + 4} y={y + 9.5} fontSize={8} fontFamily="Inter, system-ui, sans-serif" fontWeight={600} style={{ fill: color }}>
        {text}
      </text>
    </g>
  );
}

function Bar({ x, y, w }: { x: number; y: number; w: number }) {
  return <rect x={x} y={y} width={w} height={8} style={{ fill: 'rgb(var(--text-primary) / 0.15)' }} />;
}

const KNIGHT_SCENE: MiniProps['pieces'] = [
  { at: [1, 2], key: 'wn' },
  { at: [3, 0], key: 'bq' },
  { at: [2, 1], key: 'bp' },
];

/** "Hide extra info when solving": on = the panel stays blank until you move. */
export function HideInfoPreview({ hidden }: { hidden: boolean }) {
  return (
    <MiniScene pieces={KNIGHT_SCENE}>
      {hidden ? (
        <>
          <Bar x={88} y={8} w={60} />
          <Bar x={88} y={22} w={44} />
          <Bar x={88} y={36} w={52} />
        </>
      ) : (
        <>
          <Chip x={88} y={6} w={66} text="You played Nc3" />
          <Chip x={88} y={23} w={50} text="64% → 22%" fill="rgb(var(--text-primary) / 0.12)" color={INK} />
          <Chip x={88} y={40} w={56} text="See the game" fill="rgb(var(--text-primary) / 0.12)" color={INK} />
        </>
      )}
    </MiniScene>
  );
}

/** "Show raw engine evals": adds +1.2 next to the win chances. */
export function RawEvalPreview({ on }: { on: boolean }) {
  return (
    <MiniScene pieces={KNIGHT_SCENE}>
      <Chip x={88} y={14} w={30} text="64%" />
      {on && <Chip x={122} y={14} w={30} text="+1.2" fill="rgb(var(--text-primary) / 0.12)" color={INK} />}
      <Bar x={88} y={36} w={64} />
    </MiniScene>
  );
}

/** "Show the answer after a miss": the best move as a green arrow. */
export function ShowAnswerPreview({ on }: { on: boolean }) {
  return (
    <MiniScene
      pieces={[
        { at: [1, 2], key: 'wn' },
        { at: [2, 0], key: 'bq' },
        { at: [3, 1], key: 'bk' },
      ]}
      arrows={on ? [{ from: [1, 2], to: [2, 0], color: GREEN }] : []}
    >
      <Chip x={88} y={8} w={50} text="Not quite" fill={RED} />
      {on ? <Chip x={88} y={28} w={62} text="Best: Nxc8" fill={GREEN} /> : <Bar x={88} y={30} w={50} />}
    </MiniScene>
  );
}

/** "Autoplay the lines after a miss": the refutation plays out on the board. */
export function AutoplayPreview({ on }: { on: boolean }) {
  return (
    <MiniScene
      pieces={[
        { at: [0, 2], key: 'wn' },
        { at: [3, 0], key: 'bq' },
        { at: [2, 2], key: 'wk', faded: on },
      ]}
      arrows={on ? [{ from: [3, 0], to: [2, 2], color: RED, dashed: true }] : []}
    >
      {on ? (
        <>
          <path d="M90 10 L90 24 L102 17 z" style={{ fill: INK }} />
          <Chip x={106} y={10} w={46} text="Qxc1+" />
          <Bar x={88} y={34} w={58} />
        </>
      ) : (
        <>
          <rect x={90} y={10} width={4} height={14} style={{ fill: INK }} />
          <rect x={97} y={10} width={4} height={14} style={{ fill: INK }} />
          <Bar x={106} y={13} w={44} />
          <Bar x={88} y={34} w={58} />
        </>
      )}
    </MiniScene>
  );
}

/** "Play sounds": a speaker, with or without waves. */
export function SoundsPreview({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 160 60" className="h-auto w-full" aria-hidden>
      <rect x={0} y={0} width={160} height={60} style={{ fill: 'rgb(var(--surface-3))' }} />
      <path d="M58 24 H66 L78 14 V46 L66 36 H58 z" style={{ fill: INK }} />
      {on ? (
        <g fill="none" style={{ stroke: INK }} strokeWidth={3}>
          <path d="M86 22 Q92 30 86 38" />
          <path d="M93 16 Q104 30 93 44" />
        </g>
      ) : (
        <g style={{ stroke: RED }} strokeWidth={3}>
          <line x1={86} y1={22} x2={100} y2={38} />
          <line x1={100} y1={22} x2={86} y2={38} />
        </g>
      )}
    </svg>
  );
}
