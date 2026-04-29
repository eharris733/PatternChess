import type { Blunder } from './blunder';

export interface TrainingSession {
  blunders: Blunder[];
  currentIndex: number;
  currentCycle: number;
  totalCorrect: number;
  totalAttempted: number;
}

export function emptySession(blunders: Blunder[] = []): TrainingSession {
  return {
    blunders,
    currentIndex: 0,
    currentCycle: 0,
    totalCorrect: 0,
    totalAttempted: 0,
  };
}

export function currentBlunder(s: TrainingSession): Blunder | null {
  if (s.blunders.length === 0 || s.currentIndex >= s.blunders.length) return null;
  return s.blunders[s.currentIndex];
}

export function isComplete(s: TrainingSession): boolean {
  return s.currentIndex >= s.blunders.length;
}

export function sessionRecallRate(s: TrainingSession): number {
  return s.totalAttempted > 0 ? s.totalCorrect / s.totalAttempted : 0;
}

export function progressText(s: TrainingSession): string {
  return `${Math.min(s.currentIndex + 1, s.blunders.length)}/${s.blunders.length}`;
}

export function cycleText(s: TrainingSession): string {
  return `LOOP ${s.currentCycle + 1}/7`;
}
