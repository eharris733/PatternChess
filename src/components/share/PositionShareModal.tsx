import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import type { Blunder } from '../../models/blunder';
import type { GameRecord } from '../../models/gameRecord';
import { recordShare } from '../../share/recordShare';
import { copyText } from '../../share/shareFile';
import {
  buildPuzzleShareUrl,
  shareOpeningLabelFor,
  sharePlayersLabelFor,
} from '../../services/puzzleShareService';
import { TrainingShareModal } from '../training/TrainingShareModal';

const ANONYMOUS_KEY = 'pc:share-anonymous';

function readAnonymous(): boolean {
  try {
    return localStorage.getItem(ANONYMOUS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The training share dialog (Link / Screenshot / GIF) for any stored
 * position outside a drill session — owns the link, copy state and the
 * share counter so callers only pass the position and its game.
 */
export function PositionShareModal({
  blunder,
  game,
  onClose,
}: {
  blunder: Blunder;
  game: GameRecord | null;
  onClose: () => void;
}) {
  const { refreshProfile } = useAuth();
  const [anonymous, setAnonymous] = useState(readAnonymous);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(ANONYMOUS_KEY, anonymous ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts for this dialog only.
    }
  }, [anonymous]);

  const players = sharePlayersLabelFor(blunder, game);
  const opening = shareOpeningLabelFor(game);
  const shareUrl = buildPuzzleShareUrl(blunder, { players, opening, anonymous });

  const onCopy = async () => {
    if (!(await copyText(shareUrl))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 3000);
    recordShare(true, refreshProfile);
  };

  return (
    <TrainingShareModal
      blunder={blunder}
      shareUrl={shareUrl}
      sharePlayersLabel={players}
      shareOpeningLabel={opening}
      shareAnonymous={anonymous}
      setShareAnonymous={setAnonymous}
      shareCopied={copied}
      onCopy={() => void onCopy()}
      onShared={() => recordShare(true, refreshProfile)}
      onClose={onClose}
    />
  );
}
