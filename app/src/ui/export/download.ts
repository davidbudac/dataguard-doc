import { isDesktop, saveFile } from '../common/desktop';

/**
 * Hand a file to the reader: a `blob:` URL behind a `download` link, clicked
 * and removed -- a download is a navigation, which no `img-src` or
 * `connect-src` directive governs. In the desktop shell that link does nothing,
 * so the file goes through a native save dialog instead (common/desktop.ts).
 *
 * Resolves `true` once the file has been handed over, `false` when the reader
 * cancelled the desktop dialog, so a caller only says "saved" when it was.
 */
export async function downloadBlob(blob: Blob, name: string): Promise<boolean> {
  if (isDesktop()) return saveFile(name, blob);
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoking immediately races the download in Safari; a second is plenty. */
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}
