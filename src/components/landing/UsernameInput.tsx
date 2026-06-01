import { useState, type FormEvent } from 'react';
import { getStockfish } from '../../hooks/useStockfish';
import { PlatformPill } from './PlatformPill';

export type DemoPlatform = 'lichess' | 'chesscom';

interface Props {
  onSubmit: (platform: DemoPlatform, username: string) => void;
  loading?: boolean;
}

export function UsernameInput({ onSubmit, loading = false }: Props) {
  const [platform, setPlatform] = useState<DemoPlatform>('lichess');
  const [username, setUsername] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    onSubmit(platform, trimmed);
  };

  const handleFocus = () => {
    void getStockfish().catch(() => {});
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-primary/60 mr-1">
          Platform
        </span>
        <PlatformPill
          platform="lichess"
          active={platform === 'lichess'}
          onClick={() => setPlatform('lichess')}
        />
        <PlatformPill
          platform="chesscom"
          active={platform === 'chesscom'}
          onClick={() => setPlatform('chesscom')}
        />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 flex items-stretch border-2 border-text-primary bg-surface">
          <span className="hidden sm:flex items-center px-3 font-mono uppercase text-xs text-text-primary/60 border-r-2 border-text-primary bg-bg">
            {platform === 'lichess' ? 'lichess.org/@' : 'chess.com/member/'}
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onFocus={handleFocus}
            placeholder="ENTER USERNAME"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={loading}
            className="flex-1 px-4 py-3 font-mono uppercase tracking-tight text-base bg-transparent text-text-primary placeholder:text-text-primary/40 outline-none rounded-none disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="font-mono uppercase tracking-tight text-sm border-2 border-text-primary bg-gold-dark text-bg px-6 py-3 rounded-none shadow-card hover:shadow-card-hover hover:translate-x-[2px] hover:translate-y-[2px] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-card disabled:hover:translate-x-0 disabled:hover:translate-y-0 transition-all whitespace-nowrap"
        >
          {loading ? 'Analyzing…' : 'Analyze Blunders →'}
        </button>
      </div>
      <p className="font-mono uppercase text-[10px] tracking-tight text-text-primary/50">
        We only look at your chess games. Promise. 
      </p>
    </form>
  );
}
