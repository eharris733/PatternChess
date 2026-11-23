import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AVATAR_OPTIONS,
  AVATAR_PARTS,
  AVATAR_PART_LABEL,
  type AvatarPart,
  type AvatarParts,
} from '../../lib/avatar';
import { PixelAvatar } from './PixelAvatar';
import { LockIcon } from '../icons/LockIcon';
import type { RewardItem } from '../../lib/rewards';
import { useLabel, useT } from '../../i18n/useT';
import { openSupporterUnlock } from '../../state/supporterUnlockStore';

interface AvatarBuilderProps {
  /** The avatar as saved (or the generated default). */
  value: AvatarParts;
  /** True when the player has saved their own (false = the generated default). */
  custom: boolean;
  lockHint: (item: RewardItem) => string | null;
  onSave: (parts: AvatarParts | null) => Promise<void> | void;
  /** Seed for "Back to default" (the player's id). */
  seed: string;
}

const COLOR_PARTS: ReadonlySet<AvatarPart> = new Set(['background', 'skin', 'hairColor', 'outfitColor']);
const FACE_PARTS: ReadonlySet<AvatarPart> = new Set(['eyes', 'mouth']);

/**
 * The pixel avatar builder on /profile: a live preview, one row of choices
 * per part (each choice previewed on your own face), Save. Reward items show
 * a lock and what unlocks them (src/lib/rewards.ts).
 */
export function AvatarBuilder({ value, custom, lockHint, onSave, seed }: AvatarBuilderProps) {
  const t = useT();
  const label = useLabel();
  const [draft, setDraft] = useState<AvatarParts>(value);
  const [part, setPart] = useState<AvatarPart>('hair');
  const [saving, setSaving] = useState(false);
  const valueKey = JSON.stringify(value);
  useEffect(() => setDraft(JSON.parse(valueKey) as AvatarParts), [valueKey]);
  const dirty = JSON.stringify(draft) !== valueKey;

  const shuffle = () => {
    const pick = (p: AvatarPart) => {
      const open = AVATAR_OPTIONS[p].filter((o) => lockHint({ kind: 'avatar', part: p, id: o.id }) == null);
      return open[Math.floor(Math.random() * open.length)]?.id ?? draft[p];
    };
    setDraft(Object.fromEntries(AVATAR_PARTS.map((p) => [p, pick(p)])) as unknown as AvatarParts);
  };

  const save = async (parts: AvatarParts | null) => {
    setSaving(true);
    try {
      await onSave(parts);
    } finally {
      setSaving(false);
    }
  };

  const options = AVATAR_OPTIONS[part];
  // Glasses, shades and the eyepatch cover the eyes, so face-part choices are
  // previewed bare: otherwise every Eyes thumbnail looks the same.
  const previews = useMemo(
    () =>
      options.map(
        (o) =>
          ({ ...draft, ...(FACE_PARTS.has(part) ? { accessory: 'none' } : {}), [part]: o.id }) as AvatarParts,
      ),
    [options, draft, part],
  );

  return (
    <div className="flex flex-col gap-4 sm:flex-row" data-testid="avatar-builder">
      <div className="flex shrink-0 flex-col items-center gap-2 sm:w-40">
        <PixelAvatar parts={draft} className="h-32 w-32 border-2 border-text-primary" title={t('avatar.yours')} />
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={shuffle}>
            {t('avatar.shuffle')}
          </button>
          {custom && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs underline"
              onClick={() => void save(null)}
              disabled={saving}
            >
              {t('avatar.backToDefault')}
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!dirty || saving}
          data-testid="avatar-save"
          onClick={() => void save(draft)}
        >
          {saving ? t('common.saving') : dirty ? t('avatar.use') : t('avatar.saved')}
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div role="tablist" aria-label={t('avatar.part')} className="flex flex-wrap gap-1.5">
          {AVATAR_PARTS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={part === p}
              onClick={() => setPart(p)}
              className={clsx(
                'border-2 px-2 py-1 font-mono text-xs uppercase tracking-tight transition-colors',
                part === p
                  ? 'border-text-primary bg-text-primary text-bg'
                  : 'border-text-primary/40 bg-surface text-text-primary hover:border-text-primary',
              )}
            >
              {label('avatarPart', p, AVATAR_PART_LABEL[p])}
            </button>
          ))}
        </div>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-4" data-testid={`avatar-options-${part}`}>
          {options.map((o, i) => {
            const hint = lockHint({ kind: 'avatar', part, id: o.id });
            const active = draft[part] === o.id;
            const locked = hint != null && !active;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={locked ? `${o.label} (locked: ${hint})` : o.label}
                  title={hint ?? undefined}
                  data-testid={`avatar-option-${part}-${o.id}`}
                  data-locked={locked || undefined}
                  onClick={() =>
                    locked
                      ? openSupporterUnlock({
                          item: t('supporterUnlock.avatar', {
                            name: o.label,
                            part: label('avatarPart', part, AVATAR_PART_LABEL[part]),
                          }),
                          earnHint: t('supporterUnlock.orEarn', { hint: hint ?? '' }),
                        })
                      : setDraft((d) => ({ ...d, [part]: o.id }))
                  }
                  className={clsx(
                    'relative flex w-full flex-col items-center gap-1 border-2 p-1.5 transition-colors',
                    active ? 'border-accent bg-accent/10' : 'border-text-primary/20 hover:border-accent',
                    locked && 'hover:border-text-primary/50',
                  )}
                >
                  {COLOR_PARTS.has(part) && o.color ? (
                    <span
                      className={clsx('block h-10 w-10 border border-text-primary/40', locked && 'opacity-40')}
                      style={{ backgroundColor: o.color }}
                    />
                  ) : (
                    <PixelAvatar parts={previews[i]} className={clsx('h-10 w-10', locked && 'opacity-40')} />
                  )}
                  <span className="flex items-center gap-0.5 text-[11px] leading-tight text-text-primary">
                    {locked && <LockIcon className="h-3 w-3" />}
                    {o.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

