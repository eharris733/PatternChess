import { useState } from 'react';
import { canShareFiles, copyText, downloadBlob, shareOrDownload } from '../../share/shareFile';

/** Share (OS sheet, when files can be shared) · Download · Copy link for a generated image. */
export function ImageShareActions({
  blob,
  filename,
  title,
  shareText,
  shareUrl,
  onShared,
}: {
  blob: Blob | null;
  filename: string;
  title: string;
  shareText: string;
  shareUrl: string;
  onShared?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fileShare = canShareFiles();

  const onShare = async () => {
    if (!blob) return;
    const outcome = await shareOrDownload({ blob, filename, title, text: shareText, url: shareUrl });
    if (outcome !== 'cancelled') onShared?.();
  };
  const onDownload = () => {
    if (!blob) return;
    downloadBlob(blob, filename);
    onShared?.();
  };
  const onCopy = async () => {
    if (await copyText(`${shareText} ${shareUrl}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      onShared?.();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {fileShare && (
        <button type="button" className="btn-primary" disabled={!blob} onClick={() => void onShare()}>
          Share
        </button>
      )}
      <button
        type="button"
        className={fileShare ? 'btn-outline' : 'btn-primary'}
        disabled={!blob}
        onClick={onDownload}
        data-testid="share-download"
      >
        Download
      </button>
      <button type="button" className="btn-outline" onClick={() => void onCopy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
