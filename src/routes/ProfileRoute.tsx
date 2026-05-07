import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import type { TimeControlCategory } from '../services/chessApiService';

const TIME_CONTROL_OPTIONS: { value: TimeControlCategory; label: string }[] = [
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical' },
];

export function ProfileRoute() {
  const { profile, refreshProfile, user } = useAuth();
  const navigate = useNavigate();
  const [lichess, setLichess] = useState('');
  const [chesscom, setChesscom] = useState('');
  const [ratedOnly, setRatedOnly] = useState(false);
  const [timeControls, setTimeControls] = useState<TimeControlCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const timeControlsKey = profile
    ? [...profile.preferredTimeControls].sort().join(',')
    : '';
  useEffect(() => {
    setLichess(profile?.lichessUsername ?? '');
    setChesscom(profile?.chesscomUsername ?? '');
    setRatedOnly(profile?.preferredRatedOnly ?? false);
    setTimeControls(profile?.preferredTimeControls ?? []);
  }, [
    profile?.id,
    profile?.lichessUsername,
    profile?.chesscomUsername,
    profile?.preferredRatedOnly,
    timeControlsKey,
  ]);

  const toggleTimeControl = (value: TimeControlCategory) => {
    setTimeControls((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  };

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await authService.updateProfile({
        ...profile,
        lichessUsername: lichess.trim() || null,
        chesscomUsername: chesscom.trim() || null,
        preferredRatedOnly: ratedOnly,
        preferredTimeControls: timeControls,
      });
      // Claim any anon games matching either username
      if (lichess.trim()) await authService.claimAnonymousData(lichess.trim());
      if (chesscom.trim()) await authService.claimAnonymousData(chesscom.trim());
      await refreshProfile();
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const onSignOut = async () => {
    await authService.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <header className="flex items-center gap-4">
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full border border-surface-2"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-surface-2" />
        )}
        <div>
          <h1 className="heading-lg">{profile?.displayName ?? 'Your profile'}</h1>
          <p className="text-text-secondary text-sm">{user?.email}</p>
        </div>
      </header>

      <section className="card flex flex-col gap-4">
        <h2 className="heading-md">Linked accounts</h2>
        <div className="flex flex-col gap-2">
          <label className="label">Lichess username</label>
          <input
            className="input"
            placeholder="e.g. drnykterstein"
            value={lichess}
            onChange={(e) => setLichess(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label">Chess.com username</label>
          <input
            className="input"
            placeholder="e.g. hikaru"
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
          />
        </div>

        <h2 className="heading-md mt-2">Sync preferences</h2>
        <p className="text-text-secondary text-sm -mt-2">
          Applied automatically after sign-in and when you click Sync now.
        </p>
        <label className="flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={ratedOnly}
            onChange={(e) => setRatedOnly(e.target.checked)}
          />
          <span>Rated games only</span>
        </label>
        <div className="flex flex-col gap-2">
          <label className="label">Time controls</label>
          <p className="text-text-secondary text-xs -mt-1">
            Leave all unchecked to sync every time control.
          </p>
          <div className="flex flex-wrap gap-3">
            {TIME_CONTROL_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 select-none px-3 py-1.5 rounded-md bg-surface-2 border border-surface-2 hover:bg-surface cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={timeControls.includes(opt.value)}
                  onChange={() => toggleTimeControl(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-correct text-sm">Saved.</span>
          )}
        </div>
      </section>

      <section className="card flex items-center justify-between">
        <div>
          <h2 className="heading-md">Sign out</h2>
          <p className="text-text-secondary text-sm">End your session on this device.</p>
        </div>
        <button className="btn-outline" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}
