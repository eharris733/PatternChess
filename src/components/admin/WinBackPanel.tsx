import { useState } from 'react';
import clsx from 'clsx';
import {
  OUTREACH_SEGMENTS,
  useMarkContacted,
  useOutreachLeads,
  type OutreachLead,
  type OutreachSegment,
} from '../../hooks/useOutreach';
import {
  OUTREACH_SEGMENT_HINT,
  OUTREACH_SEGMENT_LABEL,
  outreachMessage,
} from '../../content/outreachTemplates';
import { chessDmUrl, chessProfileLink } from '../../lib/chessProfileUrl';
import { landingWinBackUrl, loginWinBackUrl } from '../../lib/winBack';
import { Skeleton } from '../Skeleton';
import { StageBadge } from '../../routes/AnalyticsRoute';

/**
 * Admin win-back queue: leads per funnel segment, each with a pre-filled
 * message, "Copy + open DM" (Lichess inbox / chess.com compose, or mailto for
 * Google signups without a handle) and "Mark contacted". Messages are sent by
 * hand — never automate DMs (Lichess ToS; chess.com has no messaging API).
 */
export function WinBackPanel() {
  const [segment, setSegment] = useState<OutreachSegment>('demo_only');
  const { data: payload, isError, error } = useOutreachLeads(segment);
  const counts = payload?.counts ?? {};
  // While a newly selected tab loads, the previous tab's payload is kept for
  // its counts; its rows belong to the other segment.
  const data = payload?.segment === segment ? payload : undefined;

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <span className="label">Win-back</span>
        <p className="text-text-secondary text-xs">{OUTREACH_SEGMENT_HINT[segment]}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lead segment">
        {OUTREACH_SEGMENTS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={segment === s}
            onClick={() => setSegment(s)}
            className={clsx(
              'font-mono uppercase text-[10px] tracking-tight px-2 py-1 border-2 rounded-none transition-colors',
              segment === s
                ? 'bg-text-primary text-bg border-text-primary'
                : 'border-text-primary/30 text-text-primary hover:border-text-primary',
            )}
          >
            {OUTREACH_SEGMENT_LABEL[s]}
            {counts[s] != null && <span className="ml-1.5 tabular-nums">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {isError && (
        <p className="text-incorrect text-sm">
          Couldn't load leads: {(error as Error)?.message ?? 'unknown error'}
        </p>
      )}
      {!data && !isError && <Skeleton className="h-40 w-full" />}
      {data && data.rows.length === 0 && (
        <p className="text-text-secondary text-sm">Nobody in this segment.</p>
      )}
      {data && data.rows.length > 0 && (
        <div className="flex flex-col divide-y-2 divide-text-primary/10">
          {data.rows.map((r) => (
            <LeadRow key={r.leadKey} lead={r} segment={segment} />
          ))}
        </div>
      )}
    </section>
  );
}

function leadLink(segment: OutreachSegment, lead: OutreachLead): string {
  if (segment === 'demo_only' && (lead.platform === 'lichess' || lead.platform === 'chesscom') && lead.username) {
    return landingWinBackUrl(lead.platform, lead.username);
  }
  return loginWinBackUrl();
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function LeadRow({ lead, segment }: { lead: OutreachLead; segment: OutreachSegment }) {
  const mark = useMarkContacted();
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  // In the Contacted tab the original segment isn't returned; the
  // "never trained" copy is the generic nudge for anyone with an account.
  const msgSegment: OutreachSegment =
    segment === 'contacted' ? (lead.signedUp ? 'synced_never_trained' : 'demo_only') : segment;
  const message = outreachMessage(msgSegment, {
    username: lead.username,
    blunders: lead.blunders,
    link: leadLink(msgSegment, lead),
  });
  const profile = lead.username ? chessProfileLink(lead.platform, lead.username) : null;
  const dm = lead.username ? chessDmUrl(lead.platform, lead.username) : null;
  const mailto = !dm && lead.email
    ? `mailto:${lead.email}?subject=${encodeURIComponent('Your PatternChess account')}&body=${encodeURIComponent(message)}`
    : null;
  const contacted = !!lead.contactedAt;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setOpen(true); // clipboard blocked: show the text to copy by hand
    }
  };

  return (
    <div className={clsx('flex flex-col gap-2 py-3 first:pt-0', contacted && segment !== 'contacted' && 'opacity-50')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-text-primary text-sm truncate">
            {lead.username ?? lead.email ?? lead.leadKey}
          </span>
          {profile ? (
            <a
              href={profile.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary text-[10px] truncate hover:text-text-primary underline-offset-2 hover:underline"
            >
              {profile.label}
            </a>
          ) : (
            lead.email && <span className="text-text-secondary text-[10px] truncate">{lead.email}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {lead.attempts != null && lead.attempts > 1 && (
            <span className="text-text-secondary text-[10px] tabular-nums">×{lead.attempts}</span>
          )}
          {lead.blunders != null && lead.blunders > 0 && (
            <span className="text-text-secondary text-[10px] tabular-nums">{lead.blunders} positions</span>
          )}
          {segment === 'contacted' && (
            <>
              <StageBadge on={lead.signedUp} label={lead.signedUp ? 'Has account' : 'No account'} />
              <StageBadge on={lead.trainedSinceContact} label="Trained since" />
            </>
          )}
          <span className="text-text-secondary text-xs tabular-nums">
            {contacted
              ? `Sent ${shortDate(lead.contactedAt)}`
              : shortDate(lead.lastSeen ?? lead.since)}
          </span>
        </div>
      </div>

      {lead.note && <p className="text-text-secondary text-xs">Note: {lead.note}</p>}

      {open && (
        <textarea
          readOnly
          value={message}
          rows={5}
          className="w-full text-xs bg-bg border-2 border-text-primary/20 p-2 text-text-primary"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ActionButton onClick={() => setOpen((o) => !o)}>{open ? 'Hide message' : 'Message'}</ActionButton>
        <ActionButton onClick={copy}>{copied ? 'Copied' : 'Copy'}</ActionButton>
        {dm && (
          <a
            href={dm}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void copy()}
            className={ACTION_CLASS}
          >
            Copy + open DM
          </a>
        )}
        {mailto && (
          <a href={mailto} className={ACTION_CLASS}>
            Email
          </a>
        )}
        {segment !== 'contacted' && !contacted && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className="flex-1 min-w-[8rem] text-xs bg-bg border-2 border-text-primary/20 px-2 py-1 text-text-primary"
          />
        )}
        <ActionButton
          disabled={mark.isPending}
          primary={!contacted}
          onClick={() =>
            mark.mutate({ leadKey: lead.leadKey, segment, note, undo: contacted })
          }
        >
          {contacted ? 'Undo contacted' : 'Mark contacted'}
        </ActionButton>
      </div>
    </div>
  );
}

const ACTION_BASE =
  'font-mono uppercase text-[10px] tracking-tight px-2 py-1 border-2 rounded-none transition-colors disabled:opacity-50';
const ACTION_CLASS = `${ACTION_BASE} border-text-primary/30 text-text-primary hover:border-text-primary`;
const ACTION_PRIMARY_CLASS = `${ACTION_BASE} bg-text-primary text-bg border-text-primary`;

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={primary ? ACTION_PRIMARY_CLASS : ACTION_CLASS}
    >
      {children}
    </button>
  );
}
