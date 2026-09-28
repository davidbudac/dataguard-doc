/**
 * Hand a file to the reader: a `blob:` URL behind a `download` link, clicked
 * and removed. The same path `exportDoc` takes for the JSON file -- a download
 * is a navigation, which no `img-src` or `connect-src` directive governs.
 */
export function downloadBlob(blob: Blob, name: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
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
}
