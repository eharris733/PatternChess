import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { usePgnUploadStore } from '../state/pgnUploadStore';
import { VaultGamesTab } from '../components/vault/VaultGamesTab';
import { VaultPositionsTab } from '../components/vault/VaultPositionsTab';
import { VaultRepertoireTab } from '../components/vault/VaultRepertoireTab';
import { clearFilterParams } from '../components/vault/vaultFilters';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';

type VaultTab = 'blunders' | 'mastered' | 'repertoire' | 'games';

const TABS: Array<[VaultTab, MessageKey]> = [
  ['blunders', 'vault.tab.blunders'],
  ['mastered', 'vault.tab.mastered'],
  ['repertoire', 'vault.tab.repertoire'],
  ['games', 'vault.tab.games'],
];

const isTab = (v: string | null): v is VaultTab => TABS.some(([id]) => id === v);

/** Everything you've collected: blunders, mastered positions, your repertoire, your games. */
export function VaultRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const raw = params.get('tab');
  const tab: VaultTab = isTab(raw) ? raw : 'blunders';
  const setTab = (next: VaultTab) => {
    // Position filters carry between Blunders and Mastered; the other tabs don't use them.
    const p = next === 'blunders' || next === 'mastered' ? new URLSearchParams(params) : clearFilterParams(params);
    if (next === 'blunders') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="heading-xl">{t('vault.title')}</h1>
          <p className="text-text-primary text-sm mt-1">
            {t('vault.lede')}
          </p>
        </div>
        <button className="btn-outline shrink-0" onClick={openUpload}>
          {t('vault.upload')}
        </button>
      </header>

      <div role="tablist" aria-label={t('vault.sections')} className="flex flex-wrap gap-1.5">
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
            {t(label)}
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
