/**
 * The username a visitor ran the landing demo on, kept in localStorage so the
 * onboarding "connect" step can prefill it after sign-up (the OAuth
 * round-trip loses all page state).
 */
import type { DemoPlatform } from '../services/landingDemoService';

const STORAGE_KEY = 'pc:demo-user';

export interface DemoUser {
  platform: DemoPlatform;
  username: string;
}

export function saveDemoUser(user: DemoUser): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // storage blocked — onboarding just starts empty
  }
}

export function readDemoUser(): DemoUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DemoUser>;
    if ((v.platform === 'lichess' || v.platform === 'chesscom') && typeof v.username === 'string' && v.username.trim()) {
      return { platform: v.platform, username: v.username.trim() };
    }
  } catch {
    // corrupt or blocked
  }
  return null;
}
