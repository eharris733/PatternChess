/** Hand a generated image to the OS share sheet, or download it. */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the browser can share files (mobile Safari/Chrome, some desktops). */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Web Share with the file attached; falls back to a download. */
export async function shareOrDownload(args: {
  blob: Blob;
  filename: string;
  title: string;
  text?: string;
  url?: string;
}): Promise<ShareOutcome> {
  const file = new File([args.blob], args.filename, { type: args.blob.type });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: args.title, text: args.text, url: args.url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Some browsers reject files at share time; fall through to download.
    }
  }
  downloadBlob(args.blob, args.filename);
  return 'downloaded';
}

/** Share a link through the OS sheet when available; null if unsupported. */
export async function shareLink(args: { title: string; text: string; url: string }): Promise<ShareOutcome | null> {
  if (typeof navigator === 'undefined' || !navigator.share) return null;
  try {
    await navigator.share(args);
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return null;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
