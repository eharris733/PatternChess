// Copy of MOTIF_LABEL (src/chess/motifs.ts), the app's single source of motif
// text. Importing that module would bundle chess.js into the Worker, so the
// labels live here and outbox.test.ts fails if the two ever drift apart.
export const MOTIF_LABEL: Record<string, string> = {
  hangingPiece: 'Missed hanging piece',
  leftPieceHanging: 'Left a piece hanging',
  missedMate: 'Missed mate',
  allowedMate: 'Allowed mate',
  missedFork: 'Missed fork',
  allowedFork: 'Allowed fork',
  missedSkewer: 'Missed skewer',
  allowedSkewer: 'Allowed skewer',
  missedPin: 'Missed pin',
  allowedPin: 'Allowed pin',
  missedDiscoveredAttack: 'Missed discovered attack',
  allowedDiscoveredAttack: 'Allowed discovered attack',
  backRankWeakness: 'Back-rank weakness',
  trappedPiece: 'Trapped piece',
  defensiveMistake: 'Defensive mistake',
};
