import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import {
  fetchChessComGames,
  fetchLichessGames,
  type ImportedGame,
  type TimeControlCategory,
} from '../services/chessApiService';
import { supabaseService } from '../services/supabaseService';

type Platform = 'lichess' | 'chess.com';

const GAME_COUNTS = [10, 25, 50, 100] as const;
const TIME_CONTROLS: Array<{ value: TimeControlCategory | null; label: string }> = [
  { value: null, label: 'Any' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical' },
];

export function ImportRoute() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [platform, setPlatform] = useState<Platform>('lichess');
  const [username, setUsername] = useState(
    profile?.lichessUsername ?? profile?.chesscomUsername ?? '',
  );
  const [gameCount, setGameCount] = useState<number>(25);
  const [ratedOnly, setRatedOnly] = useState(true);
  const [timeControl, setTimeControl] = useState<TimeControlCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const onPlatformChange = (next: Platform) => {
    setPlatform(next);
    if (next === 'lichess' && profile?.lichessUsername) setUsername(profile.lichessUsername);
    if (next === 'chess.com' && profile?.chesscomUsername) setUsername(profile.chesscomUsername);
  };

  const onSubmit = async () => {
    if (!username.trim()) {
      setError('Enter a username.');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(`Fetching ${gameCount} games from ${platform}…`);
    try {
      const opts = { maxGames: gameCount, ratedOnly, timeControl } as const;
      const games: ImportedGame[] =
        platform === 'lichess'
          ? await fetchLichessGames(username.trim(), {
              ...opts,
              perfType: timeControl,
            })
          : await fetchChessComGames(username.trim(), opts);

      if (games.length === 0) {
        setError('No games matched. Try a different filter.');
        return;
      }

      setStatus(`Saving ${games.length} games…`);
      const saved = await supabaseService.insertGames(
        games.map((g) => ({ ...g })) as Array<Record<string, unknown>>,
      );
      const ids = saved.map((g) => g.id);
      navigate('/analysis', { state: { gameIds: ids } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="heading-xl">Import games</h1>
        <p className="text-text-secondary text-sm mt-1">
          Pull recent games from chess.com or lichess. We'll analyze them next.
        </p>
      </header>

      <section className="card flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="label">Platform</label>
          <div className="grid grid-cols-2 gap-2">
            {(['lichess', 'chess.com'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPlatformChange(p)}
                aria-pressed={platform === p}
                className={clsx(
                  'h-12 rounded-md border text-sm font-medium transition',
                  platform === p
                    ? 'bg-accent/20 text-text-primary border-accent'
                    : 'bg-surface-2 text-text-secondary border-transparent hover:text-text-primary',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="label">Username</label>
          <input
            className="input"
            placeholder={platform === 'lichess' ? 'drnykterstein' : 'hikaru'}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="label">How many games?</label>
          <div className="flex flex-wrap gap-2">
            {GAME_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={gameCount === n}
                onClick={() => setGameCount(n)}
                className="pill"
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="label">Time control</label>
          <div className="flex flex-wrap gap-2">
            {TIME_CONTROLS.map((tc) => (
              <button
                key={tc.label}
                type="button"
                aria-pressed={timeControl === tc.value}
                onClick={() => setTimeControl(tc.value)}
                className="pill"
              >
                {tc.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="accent-accent"
            checked={ratedOnly}
            onChange={(e) => setRatedOnly(e.target.checked)}
          />
          Rated games only
        </label>

        <button className="btn-primary" onClick={onSubmit} disabled={busy}>
          {busy ? status || 'Working…' : 'Import & analyze'}
        </button>

        {error && <p className="text-incorrect text-sm">{error}</p>}
      </section>
    </div>
  );
}
