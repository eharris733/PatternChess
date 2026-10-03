import type { DrawShape } from 'chessground/draw';

export type LearnCategory = 'openings' | 'strategy' | 'endgames';

/** The only source of Learn category labels. */
export const LEARN_CATEGORY_LABEL: Record<LearnCategory, string> = {
  openings: 'Openings',
  strategy: 'Strategy',
  endgames: 'Endgames',
};

export const LEARN_CATEGORY_ORDER: readonly LearnCategory[] = ['openings', 'strategy', 'endgames'];

export type LearnLevel = 'beginner' | 'intermediate' | 'advanced';

export const LEARN_LEVEL_LABEL: Record<LearnLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** One move in a study's variation tree. `children[0]` continues the main line. */
export interface LearnNode {
  /** Stable path id within the chapter, e.g. "0.0.1". */
  id: string;
  san: string;
  uci: string;
  /** Position AFTER this move. */
  fen: string;
  /** Prose comment after the move, with Lichess markup stripped. */
  comment?: string;
  /** %cal arrows / %csl highlights attached to this move. */
  shapes?: DrawShape[];
  /** Numeric Annotation Glyphs ($1 = !, $2 = ?, ...). */
  nags?: number[];
  children: LearnNode[];
}

export interface LearnChapter {
  id: string;
  name: string;
  /** Lichess chapter URL (attribution link). */
  url: string;
  annotator: string | null;
  orientation: 'white' | 'black';
  startFen: string;
  /** Comment/shapes on the starting position, before any move. */
  intro?: string;
  introShapes?: DrawShape[];
  /** Interactive "gamebook" chapter on Lichess. */
  gamebook: boolean;
  /** First moves from the start position; `[0]` is the main line. */
  moves: LearnNode[];
}

export interface LearnStudyMeta {
  slug: string;
  studyId: string;
  title: string;
  category: LearnCategory;
  /** Opening families (as in games.opening_family) this study teaches. */
  openingFamilies: string[];
  /** Side the repertoire is for, when it is one-sided. */
  color: 'white' | 'black' | null;
  level: LearnLevel;
  author: string;
  authorUrl: string;
  studyUrl: string;
  description: string;
  /** Short human note on how reuse was licensed (shown with the credit). */
  permissionNote: string;
  chapters: Array<{ id: string; name: string }>;
}

export interface LearnStudy extends LearnStudyMeta {
  chapterData: LearnChapter[];
}

/** Classic NAG glyphs rendered as text (no emoji). */
export const NAG_GLYPH: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
};

/** NAGs that mark a move as bad — a drill never accepts these as alternatives. */
export const BAD_MOVE_NAGS: ReadonlySet<number> = new Set([2, 4, 6]);
