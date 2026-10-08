import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { usePgnUploadStore } from '../state/pgnUploadStore';
import { VaultGamesTab } from '../components/vault/VaultGamesTab';
import { VaultPositionsTab } from '../components/vault/VaultPositionsTab';
import { VaultRepertoireTab } from '../components/vault/VaultRepertoireTab';

type VaultTab = 'blunders' | 'mastered' | 'repertoire' | 'games';

const TABS: Array<[VaultTab, string]> = [
  ['blunders', 'Blunders'],
  ['mastered', 'Mastered'],
  ['repertoire', 'Repertoire'],
  ['games', 'Games'],
];

const isTab = (v: string | null): v is VaultTab => TABS.some(([id]) => id === v);

/** Everything you've collected: blunders, mastered positions, your repertoire, your games. */
export function VaultRoute() {
  const [params, setParams] = useSearchParams();
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const raw = params.get('tab');
  const tab: VaultTab = isTab(raw) ? raw : 'blunders';
  const setTab = (next: VaultTab) => {
    const p = new URLSearchParams(params);
    if (next === 'blunders') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="heading-xl">Vault</h1>
          <p className="text-text-primary text-sm mt-1">
            Your blunders, the positions you've mastered, your opening repertoire and your games. Share any of them.
          </p>
        </div>
        <button className="btn-outline shrink-0" onClick={openUpload}>
          Upload PGNs
        </button>
      </header>

      <div role="tablist" aria-label="Vault sections" className="flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`vault-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="vault-panel"
            data-testid={`vault-tab-${id}`}
            onClick={() => setTab(id)}
            className={clsx(
              'px-4 py-2 text-sm font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
              tab === id
                ? 'bg-text-primary text-bg border-text-primary'
                : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="vault-panel" aria-labelledby={`vault-tab-${tab}`}>
        {tab === 'games' ? (
          <div className="max-w-3xl">
            <VaultGamesTab />
          </div>
        ) : tab === 'repertoire' ? (
          <VaultRepertoireTab />
        ) : (
          <VaultPositionsTab key={tab} mode={tab} />
        )}
      </div>
    </div>
  );
}
