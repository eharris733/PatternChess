import clsx from 'clsx';
import { NAG_GLYPH, type LearnNode } from '../../models/learn';

/** "12." for a white move, "12..." for black; the number comes from the position after the move. */
export function moveNumberLabel(node: LearnNode, forceBlack: boolean): string | null {
  const [, stm, , , , full] = node.fen.split(' ');
  const n = Number(full) || 1;
  if (stm === 'b') return `${n}.`; // white just moved
  return forceBlack ? `${n - 1}...` : null;
}

function glyphs(node: LearnNode): string {
  return (node.nags ?? []).map((n) => NAG_GLYPH[n] ?? '').join('');
}

interface TreeProps {
  selectedId: string | null;
  onSelect: (node: LearnNode) => void;
}

function MoveToken({
  node,
  forceNumber,
  selectedId,
  onSelect,
}: TreeProps & { node: LearnNode; forceNumber: boolean }) {
  const num = moveNumberLabel(node, forceNumber);
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node)}
        data-node-id={node.id}
        aria-current={selectedId === node.id ? 'true' : undefined}
        className={clsx(
          'font-mono px-1 rounded-none transition-colors',
          selectedId === node.id ? 'bg-accent/30 text-text-primary' : 'hover:bg-accent/15',
        )}
      >
        {num && <span className="text-text-secondary mr-0.5">{num}</span>}
        {node.san}
        {glyphs(node)}
      </button>
      {node.comment && <span className="text-text-secondary text-xs mx-1">{node.comment}</span>}
    </>
  );
}

/**
 * Render the alternatives at a position: the first continues the current line
 * inline, the rest are indented beneath it (each continuing to its own end).
 */
function renderSeq(options: LearnNode[], forceNumber: boolean, props: TreeProps): JSX.Element[] {
  const out: JSX.Element[] = [];
  let opts = options;
  let force = forceNumber;
  while (opts.length > 0) {
    const [main, ...alts] = opts;
    out.push(<MoveToken key={main.id} node={main} forceNumber={force} {...props} />);
    if (alts.length > 0) {
      out.push(
        <div key={`${main.id}-alts`} className="w-full flex flex-col gap-1 pl-3 border-l-2 border-text-primary/15 my-1">
          {alts.map((alt) => (
            <div key={alt.id} className="flex flex-wrap items-baseline">
              {renderSeq([alt], true, props)}
            </div>
          ))}
        </div>,
      );
    }
    // Re-print the move number after a comment or a variation block.
    force = alts.length > 0 || !!main.comment;
    opts = main.children;
  }
  return out;
}

export function MoveTree({ moves, ...props }: TreeProps & { moves: LearnNode[] }) {
  if (moves.length === 0) return <p className="text-text-secondary text-sm">No moves in this chapter.</p>;
  return (
    <div className="flex flex-wrap items-baseline gap-y-1 text-sm leading-relaxed" data-testid="move-tree">
      {renderSeq(moves, true, props)}
    </div>
  );
}
