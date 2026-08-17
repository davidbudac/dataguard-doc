/**
 * Configure mode's bottom row: seven panels behind one tab bar (ui.md SS3).
 *
 * The seven stand in two groups, and the row says so. Four of them are *files*
 * -- text you would type or paste somewhere else, and could diff against what
 * a real deployment carries -- and three are *behaviour*: figures this page
 * draws from the same configuration. Seven mono labels in one undifferentiated
 * row read as seven of one kind, and a reader looking for the commit figure
 * hunted through the file names to find it. The labels are the only new thing:
 * the tabs, their ids and their addresses are unchanged.
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

/* ---------------- the two groups ---------------- */

export interface PanelGroup {
  /** Only ever an element id, so the label can name its own group. */
  readonly id: string;
  readonly label: string;
  readonly tabs: readonly PanelTab[];
}

/**
 * The groups, in the order the row draws them. Together they are `PANEL_TABS`,
 * exactly once each and in the same order -- a test pins that, because a tab
 * added to `state/view.ts` and not to a group here would be a panel with an
 * address and no way in.
 */
export const PANEL_GROUPS: readonly PanelGroup[] = [
  { id: 'files', label: 'Files', tabs: ['dgmgrl', 'dests', 'tns', 'show'] },
  { id: 'behaviour', label: 'Behaviour', tabs: ['app', 'commit', 'reopen'] },
];

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

function Tab({ tab, current }: { tab: PanelTab; current: PanelTab }) {
  const nIssues = issues.value.length;
  const nErrors = errors.value.length;
  return (
    <a
      class="panel-tab"
      href={panelHref(tab)}
      aria-current={tab === current ? 'page' : undefined}
      onClick={(e) => {
        /* Let the reader open a panel in a new tab if that is what they
           asked for; otherwise stay on the page and keep the fragment. */
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        panelTab.value = tab;
      }}
    >
      {PANEL_LABEL[tab]}
      {tab === 'dgmgrl' && nIssues > 0 ? (
        <span class="n" title={`${nErrors} error${nErrors === 1 ? '' : 's'}`}>{nIssues}</span>
      ) : null}
    </a>
  );
}

export function Panels() {
  useHashRoute();
  usePrintExpand();
  const tab = panelTab.value;

  return (
    <section class="panels" aria-label="Configuration">
      <FigDefs />
      {/* One row, one `nav`, two groups. The group is a `role="group"` named by
          the label inside it rather than a second navigation landmark, so a
          screen reader hears "Files, group" on the way in and the seven links
          stay one list; and the label is a real element, so nothing about the
          grouping lives in CSS alone. */}
      <nav class="panel-tabs" aria-label="Configuration panels">
        {PANEL_GROUPS.map((g) => (
          <div
            key={g.id}
            class="panel-group"
            role="group"
            aria-labelledby={`panel-group-${g.id}`}
          >
            <span class="panel-group-lbl" id={`panel-group-${g.id}`}>{g.label}</span>
            {g.tabs.map((t) => <Tab key={t} tab={t} current={tab} />)}
          </div>
        ))}
      </nav>
      {printing.value
        ? PANEL_TABS.map((t) => <Body key={t} tab={t} />)
        : <Body tab={tab} />}
    </section>
  );
}
