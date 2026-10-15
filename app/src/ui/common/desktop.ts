/**
 * The desktop shell -- the one place the page learns it is running inside the
 * Tauri wrapper in `desktop/` rather than in a browser.
 *
 * Everything the webview cannot do the way a browser does goes through here:
 * saving a file (`<a download>` is a no-op in a webview), printing on macOS
 * (WKWebView's `window.print()` does nothing), and the address a Share link
 * points at (the page's own origin is `tauri://localhost`, which is no address
 * for anyone else). The rule is that desktop-only code lives in this module and
 * nowhere else reads `window.__TAURI__`, so the web build has one thing to be
 * sure of: with the global absent every function here is a plain no-op or
 * returns `false`, and the callers fall through to the browser path they always
 * had.
 *
 * No npm dependency: the shell sets `withGlobalTauri`, which puts the API on
 * `window.__TAURI__`, and only `core.invoke` is used. The commands it calls are
 * written in `desktop/src-tauri/src/lib.rs` and allowed, by name and nothing
 * else, in `desktop/src-tauri/capabilities/default.json`.
 *
 * Not for the engine: nothing under `src/engine` may import this.
 */

/** The slice of `window.__TAURI__` this page uses. */
export interface TauriGlobal {
  core: {
    invoke<T = unknown>(
      cmd: string,
      args?: unknown,
      options?: { headers?: Record<string, string> },
    ): Promise<T>;
  };
}

/** Read the global fresh each time: tests, and a webview that injects it late, both need that. */
function tauri(): TauriGlobal | null {
  const g = (globalThis as { __TAURI__?: Partial<TauriGlobal> }).__TAURI__;
  return g && typeof g.core?.invoke === 'function' ? (g as TauriGlobal) : null;
}

/** True inside the desktop shell, false in every browser. */
export function isDesktop(): boolean {
  return tauri() !== null;
}

/**
 * Where the published page lives. A Share link built on the desktop shell's
 * own origin (`tauri://localhost` on macOS, `http://tauri.localhost` on
 * Windows) would open nowhere for whoever receives it, so on desktop the link
 * is made against this instead. The site is its own host, with a landing
 * page at the root and this application under `/advanced/` (site/publish.sh,
 * AGENTS.md "Publishing"); the `/dataguard/` in older notes is the path it
 * had before it moved there.
 */
export const PUBLIC_URL = 'https://dataguard.davidbudac.cz/advanced/';

/**
 * The base a Share link is appended to: the public address on desktop, else
 * the page's own `origin + pathname` (a browser, wherever it is served from --
 * a sub-path, a preview host). `here` is what the page's location gives.
 */
export function shareBase(here: string): string {
  return isDesktop() ? PUBLIC_URL : here;
}

/** The file names come out of `exportStem`, but a header is no place for a raw one. */
const NAME_HEADER = 'x-file-name';

/**
 * Save `blob` as `name`: a native save dialog, then the bytes written where
 * the reader chose. Resolves `true` when a file was written and `false` when
 * the reader cancelled the dialog; rejects if the write failed. Off desktop it
 * resolves `false` without doing anything -- callers check `isDesktop()` first
 * and keep their browser path.
 */
export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  const t = tauri();
  if (t === null) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  /* A raw body rather than an array of numbers: a PNG is megabytes, and JSON
     would turn every byte into a few characters. */
  return t.core.invoke<boolean>('save_file', bytes, {
    headers: { [NAME_HEADER]: encodeURIComponent(name) },
  });
}

/** Print the page: the native path on desktop. Returns false where the caller should `window.print()`. */
export async function printNative(): Promise<boolean> {
  const t = tauri();
  if (t === null) return false;
  await t.core.invoke('print_page');
  return true;
}

/**
 * An `<a download href>` that works on desktop: the click is taken over, the
 * file fetched from the page's own origin and handed to `saveFile`. In a
 * browser the handler does nothing and the anchor downloads as ever.
 */
export function desktopDownload(name: string): (e: Event) => void {
  return (e) => {
    if (!isDesktop()) return;
    e.preventDefault();
    const href = (e.currentTarget as HTMLAnchorElement).href;
    void fetch(href)
      .then((r) => r.blob())
      .then((b) => saveFile(name, b))
      .catch(() => undefined);
  };
}
