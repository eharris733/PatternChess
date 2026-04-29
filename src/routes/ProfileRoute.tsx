import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';

export function ProfileRoute() {
  const { profile, refreshProfile, user } = useAuth();
  const navigate = useNavigate();
  const [lichess, setLichess] = useState('');
  const [chesscom, setChesscom] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setLichess(profile?.lichessUsername ?? '');
    setChesscom(profile?.chesscomUsername ?? '');
  }, [profile?.id, profile?.lichessUsername, profile?.chesscomUsername]);

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await authService.updateProfile({
        ...profile,
        lichessUsername: lichess.trim() || null,
        chesscomUsername: chesscom.trim() || null,
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
