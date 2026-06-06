import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { usePgnUploadStore } from '../state/pgnUploadStore';
import {
  PgnUploadProgress,
  PgnUploadResult,
  splitMultiGamePgn,
  uploadPgns,
} from '../services/pgnUploadService';
import { ProgressBar } from './ProgressBar';

type Stage = 'pick' | 'running' | 'done' | 'error';

export function PgnUploadModal() {
  const open = usePgnUploadStore((s) => s.open);
  const closeModal = usePgnUploadStore((s) => s.closeModal);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const [stage, setStage] = useState<Stage>('pick');
  const [pgnText, setPgnText] = useState('');
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const defaultName =
    profile?.lichessUsername ?? profile?.chesscomUsername ?? profile?.displayName ?? '';
  const [userPgnName, setUserPgnName] = useState(defaultName);
  const [progress, setProgress] = useState<PgnUploadProgress | null>(null);
  const [result, setResult] = useState<PgnUploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever the modal opens fresh.
  useEffect(() => {
    if (!open) return;
    setStage('pick');
    setPgnText('');
    setFileLabel(null);
    setUserPgnName(defaultName);
    setProgress(null);
    setResult(null);
    setErrorMsg(null);
  }, [open, defaultName]);

  const parsedCount = (() => {
    if (!pgnText.trim()) return 0;
    try {
      return splitMultiGamePgn(pgnText).length;
    } catch {
      return 0;
    }
  })();

  const onFilePick = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const texts: string[] = [];
    let totalSize = 0;
    for (const file of Array.from(files)) {
      const text = await file.text();
      texts.push(text);
      totalSize += file.size;
    }
    const combined = texts.join('\n\n');
    setPgnText((cur) => (cur.trim() ? `${cur.trim()}\n\n${combined}` : combined));
    setFileLabel(
      files.length === 1
        ? files[0].name
        : `${files.length} files (${Math.round(totalSize / 1024)} KB)`,
    );
  }, []);

  const canStart =
    stage === 'pick' &&
    pgnText.trim().length > 0 &&
    userPgnName.trim().length > 0 &&
    parsedCount > 0;

  const onStart = async () => {
    if (!canStart) return;
    setStage('running');
    setErrorMsg(null);
    try {
      const res = await uploadPgns({
        pgnText,
        userPgnName,
        onProgress: setProgress,
      });
      setResult(res);
      setStage('done');
      // Invalidate + force refetch so /vault and the homework card show the
      // new rows immediately, even if no component is currently subscribed.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['games'], type: 'all' }),
        // ['blunders'] is the shared prefix for the due / dueTomorrow / stats
        // queries; the old ['dueBlunders'] key matched nothing, so the goals
        // card and dashboard never refreshed after an upload.
        queryClient.refetchQueries({ queryKey: ['blunders'], type: 'all' }),
        queryClient.refetchQueries({ queryKey: ['blunderCounts'], type: 'all' }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setErrorMsg(msg);
      setStage('error');
    }
  };

  const onClose = () => {
    if (stage === 'running') return;
    closeModal();
  };

  const onContinue = () => {
    closeModal();
    navigate('/vault');
  };

  if (!open) return null;

  const phaseLabel = (() => {
    if (!progress) return 'Preparing…';
    switch (progress.phase) {
      case 'parsing':
        return 'Parsing PGNs';
      case 'inserting':
        return 'Saving games';
      case 'analyzing':
        return 'Analyzing for blunders';
      case 'done':
        return 'Done';
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload PGNs"
      onClick={onClose}
    >
      <div
        className="card max-w-xl w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between">
          <h2 className="heading-lg">Upload PGNs</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={stage === 'running'}
            className="text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {stage === 'pick' && (
          <>
            <p className="text-text-secondary text-sm">
              Paste PGN text or upload one or more <code>.pgn</code> files. Multi-game
              PGN exports from Chess.com and Lichess are supported.
            </p>

            <div className="flex flex-col gap-2">
              <label className="label">Your name in these games</label>
              <input
                className="input"
                placeholder="e.g. drnykterstein"
                value={userPgnName}
                onChange={(e) => setUserPgnName(e.target.value)}
              />
              <p className="text-text-secondary text-xs">
                Used to identify which side is yours in each PGN's [White] / [Black] header.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">PGN file(s)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pgn,.txt,application/x-chess-pgn,text/plain"
                multiple
                className="block w-full text-sm text-text-primary file:mr-3 file:inline-flex file:items-center file:h-10 file:px-4 file:rounded-none file:border-2 file:border-text-primary file:bg-surface file:text-text-primary file:font-mono file:uppercase file:text-xs file:tracking-tight file:cursor-pointer file:transition-colors hover:file:bg-text-primary hover:file:text-bg"
                onChange={(e) => void onFilePick(e.target.files)}
              />
              {fileLabel && (
                <p className="text-text-secondary text-xs">Loaded: {fileLabel}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">…or paste PGN</label>
              <textarea
                className="input font-mono text-xs h-40"
                placeholder={'[Event "..."]\n[Site "..."]\n[White "..."]\n[Black "..."]\n\n1. e4 e5 ...'}
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
              />
              <p className="text-text-secondary text-xs">
                {parsedCount > 0
                  ? `${parsedCount} game${parsedCount === 1 ? '' : 's'} detected.`
                  : 'No games detected yet.'}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 mt-2">
              <button type="button" className="btn-outline" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void onStart()}
                disabled={!canStart}
              >
                Import {parsedCount > 0 ? `${parsedCount} game${parsedCount === 1 ? '' : 's'}` : ''}
              </button>
            </div>
          </>
        )}

        {stage === 'running' && (
          <div className="flex flex-col gap-4">
            <p className="text-text-secondary text-sm">
              Importing and analyzing your games. This usually takes a few seconds
              per game.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text-primary">{phaseLabel}</span>
                {progress && (
                  <span className="text-text-secondary font-mono text-xs">
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              <ProgressBar current={progress?.current ?? 0} total={progress?.total ?? 1} />
              {progress && progress.blundersFound > 0 && (
                <p className="text-text-secondary text-xs">
                  {progress.blundersFound} blunder
                  {progress.blundersFound === 1 ? '' : 's'} found so far
                </p>
              )}
            </div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl text-correct" aria-hidden>
                ✓
              </span>
              <div className="flex flex-col">
                <p className="heading-md">
                  {result.inserted} game{result.inserted === 1 ? '' : 's'} imported
                </p>
                <p className="text-text-secondary text-sm">
                  {result.blundersFound} blunder{result.blundersFound === 1 ? '' : 's'} found
                  {result.duplicates > 0
                    ? ` · ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" className="btn-outline" onClick={() => closeModal()}>
                Close
              </button>
              <button type="button" className="btn-primary" onClick={onContinue}>
                Continue to your vault
              </button>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-4 text-sm">
              <div className="font-mono uppercase text-xs tracking-tight mb-1">Upload failed</div>
              <div className="text-text-secondary">{errorMsg ?? 'Something went wrong.'}</div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" className="btn-outline" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setStage('pick')}
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
