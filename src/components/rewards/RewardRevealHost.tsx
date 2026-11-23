import { useEffect } from 'react';
import { create } from 'zustand';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useRewardState, useRungRewardState } from '../../hooks/useRewardState';
import { useCosmeticsApply } from './useCosmeticsApply';
import { useTrainingStore } from '../../state/trainingStore';
import { ACHIEVEMENTS } from '../../lib/achievements';
import { FREEZE_RUNGS, REWARDS, rewardTitle, rewardUnlocked, type Reward, type RewardState } from '../../lib/rewards';
import { claimPathReward } from '../../services/db/cosmetics';
import { playSound } from '../../lib/sounds';
import { RewardPreview } from './RewardPreview';
import { CloseIcon } from '../icons/CloseIcon';

/**
 * Shows each newly earned reward (src/lib/rewards.ts) once, in a modal: the
 * payoff for a path rung or an achievement. Mounted in AppShell.
 *
 * - Seen-set per player in localStorage (`pc:rewards-seen:<uid>`). The first
 *   evaluation only seeds it, so history never pops up (like the chimes).
 * - Achievement rewards are only judged where the achievements are already
 *   loaded (ACHIEVEMENT_ROUTES); elsewhere only rung rewards are, so this
 *   never pulls the games list onto every screen.
 * - Streak-freeze rungs are banked through the server (profile.claimPathReward)
 *   and shown once the server confirms.
 * - Never mid-drill: held while a /training position or an /endgames
 *   play-out is open, and shown when the session is over or you move on.
 * - Rewards a supporter has only because of the perk are never "revealed".
 */

const SEEN_KEY = (uid: string) => `pc:rewards-seen:${uid}`;
const ACHIEVEMENT_ROUTES = ['/dashboard', '/path', '/profile', '/achievements', '/leaderboards'];

interface SeenRecord {
  ids: string[];
  /** Whether achievement rewards have been seeded too. */
  ach: boolean;
}

function readSeen(uid: string): SeenRecord | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SeenRecord>;
    return { ids: Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === 'string') : [], ach: v.ach === true };
  } catch {
    return null;
  }
}

function writeSeen(uid: string, rec: SeenRecord) {
  try {
    localStorage.setItem(SEEN_KEY(uid), JSON.stringify(rec));
  } catch {
    /* private mode */
  }
}

// Freeze claims tried this tab session (a 'not_reached' answer waits for a reload).
const claimTried = new Set<string>();
// Players whose seen-set was seeded in this tab: their history is never revealed.
const seededThisSession = new Set<string>();

/** Rewards waiting to be shown. A store, so a route change (which swaps the evaluator) keeps them. */
const useRewardQueue = create<{ queue: Reward[]; add: (r: Reward[]) => void; clear: () => void }>((set) => ({
  queue: [],
  add: (r) =>
    set((s) => {
      const add = r.filter((x) => !s.queue.some((q) => q.id === x.id));
      return add.length ? { queue: [...s.queue, ...add] } : s;
    }),
  clear: () => set({ queue: [] }),
}));

export function RewardRevealHost() {
  const { pathname } = useLocation();
  const trainingPhase = useTrainingStore((s) => s.phase);
  const queue = useRewardQueue((s) => s.queue);
  const clear = useRewardQueue((s) => s.clear);
  const withAchievements = ACHIEVEMENT_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  const midDrill =
    (pathname.startsWith('/training') && trainingPhase !== 'complete' && trainingPhase !== 'empty') ||
    pathname.startsWith('/endgames');
  const showing = queue.length > 0 && !midDrill;
  useEffect(() => {
    if (showing) playSound('achievement');
  }, [showing]);

  return (
    <>
      {withAchievements ? <WithAchievements /> : <RungsOnly />}
      {showing && <RewardRevealModal rewards={queue} onClose={clear} />}
    </>
  );
}

function WithAchievements() {
  return <RevealCore state={useRewardState()} />;
}

function RungsOnly() {
  return <RevealCore state={useRungRewardState()} />;
}

function RevealCore({ state }: { state: RewardState & { ready: boolean; achievementsKnown: boolean } }) {
  const { profile, refreshProfile } = useAuth();
  const addToQueue = useRewardQueue((s) => s.add);
  const achKey = [...state.achievements].sort().join(',');

  const uid = profile?.id ?? null;
  const claimedKey = (profile?.pathRewardsClaimed ?? []).join(',');

  // Cosmetic rewards: diff against the seen-set.
  useEffect(() => {
    if (!uid || !state.ready) return;
    const earnedByProgress = { ...state, isSupporter: false };
    const judged = REWARDS.filter(
      (r) => r.item.kind !== 'streakFreeze' && ('rung' in r.unlock || state.achievementsKnown),
    );
    const earned = judged.filter((r) => rewardUnlocked(r, earnedByProgress)).map((r) => r.id);
    const rec = readSeen(uid);
    if (!rec) {
      seededThisSession.add(uid);
      writeSeen(uid, { ids: earned, ach: state.achievementsKnown });
      return;
    }
    let seen = rec.ids;
    const seedAch = state.achievementsKnown && !rec.ach;
    if (seedAch) {
      // First time achievements are judged for this player: their achievement rewards are history.
      const achIds = earned.filter((id) => REWARDS.some((r) => r.id === id && 'achievement' in r.unlock));
      seen = [...new Set([...seen, ...achIds])];
    }
    const fresh = earned.filter((id) => !seen.includes(id));
    if (fresh.length === 0 && !seedAch) return;
    writeSeen(uid, { ids: [...seen, ...fresh], ach: rec.ach || state.achievementsKnown });
    if (fresh.length) addToQueue(REWARDS.filter((r) => fresh.includes(r.id)));
    // `state` is rebuilt each render; these are its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, state.ready, state.trained, state.achievementsKnown, achKey, addToQueue]);

  // Streak-freeze rungs: bank through the server once reached.
  useEffect(() => {
    if (!uid || !state.ready) return;
    const claimed = new Set(claimedKey ? claimedKey.split(',').map(Number) : []);
    const firstRun = seededThisSession.has(uid);
    for (const rung of FREEZE_RUNGS) {
      const tryKey = `${uid}:${rung}`;
      if (state.trained < rung || claimed.has(rung) || claimTried.has(tryKey)) continue;
      claimTried.add(tryKey);
      void claimPathReward(rung)
        .then((res) => {
          if (!res.granted) return;
          void refreshProfile();
          const reward = REWARDS.find((r) => r.item.kind === 'streakFreeze' && 'rung' in r.unlock && r.unlock.rung === rung);
          if (reward && !firstRun) addToQueue([reward]);
        })
        .catch((err) => console.warn('[rewards] claim failed', err));
    }
  }, [uid, state.ready, state.trained, claimedKey, refreshProfile, addToQueue]);

  return null;
}

function unlockedFor(reward: Reward): string {
  if ('rung' in reward.unlock) return `${reward.unlock.rung.toLocaleString()} positions trained`;
  const id = reward.unlock.achievement;
  return ACHIEVEMENTS.find((a) => a.id === id)?.title ?? 'Achievement';
}

export function RewardRevealModal({ rewards, onClose }: { rewards: Reward[]; onClose: () => void }) {
  const apply = useCosmeticsApply();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cosmetics = rewards.filter((r) => r.item.kind !== 'streakFreeze');
  const single = cosmetics.length === 1 ? cosmetics[0] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reward unlocked"
      data-testid="reward-reveal"
      onClick={onClose}
    >
      <div className="card relative w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Close"
          className="btn-ghost absolute top-3 right-3 p-1 text-text-primary"
          onClick={onClose}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <header className="flex flex-col gap-1 pr-10">
          <span className="label">{rewards.length === 1 ? 'Reward unlocked' : `${rewards.length} rewards unlocked`}</span>
          <h2 className="heading-lg">{rewards.length === 1 ? rewardTitle(rewards[0].item) : 'Nice work. These are yours now.'}</h2>
        </header>
        <ul className="flex flex-col gap-3">
          {rewards.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-2 border-text-primary/20 p-2" data-testid={`reward-${r.id}`}>
              <RewardPreview item={r.item} />
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold text-text-primary">{rewardTitle(r.item)}</span>
                <span className="text-xs text-text-primary">For {unlockedFor(r)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {single && (
            <button
              type="button"
              className="btn-primary"
              data-testid="reward-use"
              onClick={() => {
                apply(single.item);
                onClose();
              }}
            >
              Use it now
            </button>
          )}
          <Link to="/profile#look" className={single ? 'btn-outline' : 'btn-primary'} onClick={onClose}>
            See your rewards
          </Link>
          <button type="button" className="btn-ghost underline" onClick={onClose}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
