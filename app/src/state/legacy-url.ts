/**
 * Deep-link compatibility with the published page (ui.md SS6.4).
 *
 * Every link the handover document, the wiki page and the reading list hand
 * out is of the form `?sc=iso&lat=2#ch-clocks`. Those links keep working: the
 * query is the published FIELDS vocabulary, which the engine already knows how
 * to read (`legacyQueryToKnobs`), and the six chapter anchors name places this
 * application still has. Nothing is guessed at -- an unknown token is dropped,
 * reported, and the canonical URL is written back with `replaceState`.
 *
 * Two keys the engine's table deliberately has no entry for, because the
 * published page owned them rather than its models:
 *
 *   `ver=26ai`  the edition -- a reading preference here, so it lands on `ed`
 *   `lang=`     the reading language of a page that no longer has one. Older
 *               links still carry it, so it is recognised and ignored rather
 *               than reported as unknown.
 */

import { LEGACY_URL_FIELDS, migrateLegacyQuery } from '@/engine';
import type { Edition, TopologyDoc } from '@/engine';
import type { Mode, PanelTab } from './view';
import { splitQuery } from './url';

/** Where the published page keeps serving from, once this one is the default. */
export const LEGACY_PATH = 'legacy/';

export interface LegacyAnchorTarget {
  mode: Mode;
  panel?: PanelTab;
  lesson?: string;
}

/**
 * The six chapters of the published document, and where each one went. The
 * mapping is the migration table in ui.md SS6, kept in code so a link that
 * points at a chapter lands on the thing that replaced it.
 */
export const LEGACY_ANCHORS: Record<string, LegacyAnchorTarget> = {
  'ch-clocks': { mode: 'break' },
  'ch-transport': { mode: 'configure', panel: 'commit' },
  'ch-app': { mode: 'configure', panel: 'app' },
  'ch-config': { mode: 'configure', panel: 'dgmgrl' },
  'ch-side': { mode: 'learn', lesson: 'sync-transport' },
  'ch-reference': { mode: 'learn', lesson: 'reference' },
};

const LEGACY_KEYS = new Set<string>([
  ...LEGACY_URL_FIELDS.map((f) => f.k),
  'ver',
  'lang',
]);

export interface LegacyView {
  mode?: Mode;
  panel?: PanelTab;
  lesson?: string;
  ed?: Edition;
}

export interface LegacyUpgrade {
  /** The classic topology the legacy knobs describe. */
  topology: TopologyDoc;
  view: LegacyView;
  /** Query keys that were not part of the published vocabulary. */
  dropped: string[];
  /** One sentence for the strip, or null when there is nothing to say. */
  notice: string | null;
}

const stripHash = (hash: string): string => (hash.startsWith('#') ? hash.slice(1) : hash);

/** True when this URL is one the published page wrote. */
export function isLegacyUrl(search: string, hash = ''): boolean {
  const anchor = stripHash(hash);
  if (Object.prototype.hasOwnProperty.call(LEGACY_ANCHORS, anchor)) return true;
  return splitQuery(search).some(([k]) => LEGACY_KEYS.has(k));
}

/**
 * Upgrade a published-page URL. Returns null when the URL is not one -- that
 * is the normal case, not an error.
 */
export function upgradeLegacyUrl(search: string, hash = ''): LegacyUpgrade | null {
  if (!isLegacyUrl(search, hash)) return null;

  const pairs = splitQuery(search);
  const query: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [k, v] of pairs) {
    if (LEGACY_KEYS.has(k)) query[k] = v;
    else dropped.push(k);
  }

  /* The engine owns the knob vocabulary, clamping included. */
  const topology = migrateLegacyQuery(query);

  const view: LegacyView = {};
  const ver = query['ver'];
  if (ver === '19c' || ver === '26ai') view.ed = ver;

  const anchor = stripHash(hash);
  const target = LEGACY_ANCHORS[anchor];
  if (target) {
    view.mode = target.mode;
    if (target.panel) view.panel = target.panel;
    if (target.lesson) view.lesson = target.lesson;
  }

  const notice = dropped.length > 0
    ? `Upgraded an older link. Dropped ${dropped.length} unknown parameter${dropped.length === 1 ? '' : 's'}: ${dropped.join(', ')}.`
    : 'Upgraded an older link.';

  return { topology, view, dropped, notice };
}
