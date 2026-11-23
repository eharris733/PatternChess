import { create } from 'zustand';
import { DEFAULT_PIECE_SET, isPieceSet, type PieceSet } from '../lib/pieceSets';

/**
 * The board's piece set, mirrored onto `<html data-piece-set>` so the board
 * CSS (src/styles/pieceSets.css) and the share canvas (boardCanvas
 * loadPieceImages) both follow it. Like the theme, the device keeps its own
 * copy in localStorage and the profile (`profiles.piece_set`) syncs it across
 * devices (AuthProvider adopts the server value on load; the picker writes
 * both).
 */

const STORAGE_KEY = 'patternchess.pieceSet';

function readInitial(): PieceSet {
  if (typeof window === 'undefined') return DEFAULT_PIECE_SET;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isPieceSet(stored)) return stored;
  } catch {
    // ignore
  }
  return DEFAULT_PIECE_SET;
}

/** Whether this device has its own piece-set pick (same rule as hasStoredTheme). */
export function hasStoredPieceSet(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return isPieceSet(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function applyPieceSetToDom(set: PieceSet) {
  if (typeof document === 'undefined') return;
  if (set === DEFAULT_PIECE_SET) delete document.documentElement.dataset.pieceSet;
  else document.documentElement.dataset.pieceSet = set;
}

/** The set the document currently shows (what share images should draw). */
export function currentDomPieceSet(): PieceSet {
  if (typeof document === 'undefined') return DEFAULT_PIECE_SET;
  const v = document.documentElement.dataset.pieceSet;
  return isPieceSet(v) ? v : DEFAULT_PIECE_SET;
}

interface PieceSetState {
  pieceSet: PieceSet;
  setPieceSet: (s: PieceSet) => void;
}

const initial = readInitial();
applyPieceSetToDom(initial);

export const usePieceSetStore = create<PieceSetState>((set) => ({
  pieceSet: initial,
  setPieceSet: (s) => {
    applyPieceSetToDom(s);
    try {
      window.localStorage.setItem(STORAGE_KEY, s);
    } catch {
      // ignore
    }
    set({ pieceSet: s });
  },
}));
