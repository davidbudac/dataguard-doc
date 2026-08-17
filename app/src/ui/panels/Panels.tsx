/**
 * Configure mode's bottom row: seven panels behind one tab bar (ui.md SS3).
 *
 * The tabs are real links. Each one carries an `href` to the canonical address
 * for that panel, so it survives a middle click, a right-click-copy and a
 * bookmark; the click handler sets the signals directly and lets the debounced
 * URL writer put the address bar right, because the fragment carries the
 * Document and a link must never be allowed to overwrite it.
 *
 * `#/configure/<panel>` is accepted as an alias on load and on `hashchange`,
 * which is the spelling ui.md gives for a panel deep link. It is read, never
 * written: the fragment is where `#t=` lives, and the canonical form of "which
 * panel" is the `panel=` query key that `state/url.ts` owns.
 *
 * Nothing here is hidden by CSS. The panel that is not open is not rendered.
 */

import { useEffect } from 'preact/hooks';
import { errors, issues } from '@/state/derived';
import { currentUrlState, serializeUrlQuery } from '@/state/url';
import { mode, panelTab, PANEL_LABEL, PANEL_TABS } from '@/state/view';
import type { PanelTab } from '@/state/view';
import { printing, usePrintExpand } from '../print';
import { FigDefs } from './figure';
import { Dgmgrl } from './Dgmgrl';
import { Dests } from './Dests';
import { Tns } from './Tns';
import { Show } from './Show';
import { AppView } from './AppView';
import { Commit } from './Commit';
import { Reopen } from './Reopen';
import '@/styles/panels.css';

/* ---------------- the hash alias ---------------- */

const ROUTE = /^#\/configure\/([a-z]+)$/;

/** `#/configure/commit` -> `'commit'`; anything else -> null. */
export function panelFromHash(hash: string): PanelTab | null {
  const m = ROUTE.exec(hash);
  const tab = m?.[1];
  if (tab === undefined) return null;
  return (PANEL_TABS as readonly string[]).includes(tab) ? (tab as PanelTab) : null;
}

/** The address a tab links to: the query the URL table would write for it. */
export function panelHref(tab: PanelTab): string {
  const query = serializeUrlQuery({ ...currentUrlState(), mode: 'configure', panel: tab });
  const hash = typeof location === 'undefined' ? '' : location.hash;
  return `${query === '' ? '?' : `?${query}`}${hash.startsWith('#/') ? '' : hash}`;
}

/** Reads the alias once, and again whenever the fragment changes. */
export function useHashRoute(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const read = (): void => {
      const tab = panelFromHash(location.hash);
      if (tab === null) return;
      mode.value = 'configure';
      panelTab.value = tab;
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
}

/* ---------------- print ---------------- */

/**
 * On paper there is no current tab. The tab bar is navigation and drops out,
 * and all seven panels print one after another -- which no CSS rule can fake,
 * because the panel that is not open is not in the document at all.
 *
 * The signal and its listener moved to `ui/print.ts` when the validation
 * panel grew a fold of its own: `beforeprint` fires on the window once, and a
 * collapsible in Build cannot hang off a hook only Configure mounts. Re-exported
 * here because this is where callers learned to look for it.
 */
export { printing, usePrintExpand } from '../print';

/* ---------------- the row ---------------- */

function Body({ tab }: { tab: PanelTab }) {
  switch (tab) {
    case 'dgmgrl': return <Dgmgrl />;
    case 'dests': return <Dests />;
    case 'tns': return <Tns />;
    case 'show': return <Show />;
    case 'app': return <AppView />;
    case 'commit': return <Commit />;
    case 'reopen': return <Reopen />;
  }
}

export function Panels() {
  useHashRoute();
  usePrintExpand();
  const tab = panelTab.value;
  const nIssues = issues.value.length;
  const nErrors = errors.value.length;

  return (
    <section class="panels" aria-label="Configuration">
      <FigDefs />
      <nav class="panel-tabs" aria-label="Configuration panels">
        {PANEL_TABS.map((t) => (
          <a
            key={t}
            class="panel-tab"
            href={panelHref(t)}
            aria-current={t === tab ? 'page' : undefined}
            onClick={(e) => {
              /* Let the reader open a panel in a new tab if that is what they
                 asked for; otherwise stay on the page and keep the fragment. */
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              panelTab.value = t;
            }}
          >
            {PANEL_LABEL[t]}
            {t === 'dgmgrl' && nIssues > 0 ? (
              <span class="n" title={`${nErrors} error${nErrors === 1 ? '' : 's'}`}>{nIssues}</span>
            ) : null}
          </a>
        ))}
      </nav>
      {printing.value
        ? PANEL_TABS.map((t) => <Body key={t} tab={t} />)
        : <Body tab={tab} />}
    </section>
  );
}
