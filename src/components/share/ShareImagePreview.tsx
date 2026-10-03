import type { RenderedImage } from './useRenderedImage';

/**
 * A generated share image framed exactly like the live board (2px ink
 * border + card shadow), so Link / Screenshot / GIF read as one family.
 * `aspect` (width / height) reserves the space while it renders.
 */
export function ShareImagePreview({
  image,
  label,
  aspect = 1,
}: {
  image: RenderedImage;
  label?: string;
  aspect?: number;
}) {
  return (
    <div
      className="relative w-full border-2 border-text-primary bg-surface-3 shadow-card"
      style={{ aspectRatio: String(aspect) }}
    >
      {image.url ? (
        <img
          src={image.url}
          alt={label ?? ''}
          className="absolute inset-0 block h-full w-full object-contain"
          data-testid="share-preview"
        />
      ) : (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-sm text-text-primary">
          {image.error ? "Couldn't build the image. Try again." : 'Rendering…'}
        </p>
      )}
    </div>
  );
}
