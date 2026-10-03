import { CloseIcon } from '../icons/CloseIcon';
import { ImageShareActions } from './ImageShareActions';
import { ShareImagePreview } from './ShareImagePreview';
import { useRenderedImage } from './useRenderedImage';

/**
 * Preview + share one generated image (the achievement card). The puzzle
 * share modal composes the same pieces with a format picker instead.
 * `onShared` fires once per successful action (share counter).
 */
export function ShareImageModal({
  title,
  render,
  filename,
  shareText,
  shareUrl,
  onShared,
  onClose,
}: {
  title: string;
  render: () => Promise<Blob>;
  filename: string;
  shareText: string;
  shareUrl: string;
  onShared?: () => void;
  onClose: () => void;
}) {
  const image = useRenderedImage(filename, render);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="card relative max-w-lg w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="btn-ghost absolute top-3 right-3 p-1 text-text-secondary hover:text-text-primary"
          onClick={onClose}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <h2 className="heading-lg text-center">{title}</h2>
        <ShareImagePreview image={image} aspect={1200 / 630} />
        <ImageShareActions
          blob={image.blob}
          filename={filename}
          title={title}
          shareText={shareText}
          shareUrl={shareUrl}
          onShared={onShared}
        />
      </div>
    </div>
  );
}
