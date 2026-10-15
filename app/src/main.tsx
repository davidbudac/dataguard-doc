/**
 * Boot (ui.md SS2.6).
 *
 * Order matters, and every step is a fallback rather than a guess:
 *
 *   theme      ?theme=  ->  localStorage  ->  auto
 *   edition    ?ed=     ->  localStorage  ->  19c
 *   the page  the Topology workbench, unless ?intro=1 asks for the
 *             Introduction; a first visit does not open it on its own
 *   document   #t= / #t0= / #cfg2= / #cfg=
 *                       ->  ?preset= / ?lesson=
 *                       ->  a published-page link (?sc=...#ch-clocks)
 *                       ->  localStorage dg-doc-v1
 *                       ->  the classic 1+1+1 configuration
 *   view       whatever the query says, clamped
 *
 * Then, and only then, the URL and autosave effects start -- so boot never
 * writes back what it just read.
 */

import { render } from 'preact';
import { Root } from './ui/Root';
import { classicDoc, makeDoc, startingDoc } from './state/doc';
import type { Doc } from './state/doc';
import { findPreset } from './presets';
import { resetHistory } from './state/history';
import { decodeFragment, fragmentKind } from './state/codec';
import {
  announceRestore, loadDoc, loadEdition, loadGrid, loadHints, loadIntro, loadIssuesOpen, loadPalette,
  loadBreakTimeline, loadRailCollapsed, loadSummaryOpen, loadTheme, loadTimelineOpen,
  startAutosave, loadOutcomeDrawing,
} from './state/persist';
import { upgradeLegacyUrl } from './state/legacy-url';
import { applyLearnRoute, openLessonStep, startLearnRouting } from './ui/learn/route';
import { introOnBoot } from './ui/intro/route';
import { lessonById } from './content';
import {
  applyUrlState, parseUrlQuery, presetId, splitQuery, startUrlSync, URL_DEFAULTS,
} from './state/url';
import type { UrlState } from './state/url';
import { applyPalette, applyTheme, introPage, palette, startViewportWatch, toast } from './state/view';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/float.css';
import './styles/rail.css';
import './styles/timeline-bar.css';
import './styles/lanes.css';
import './styles/summary.css';
import './styles/popout.css';
import './styles/print.css';
import './styles/hierarchy.css';

async function boot(): Promise<void> {
  const search = typeof location === 'undefined' ? '' : location.search;
  const hash = typeof location === 'undefined' ? '' : location.hash;
  const present = new Set(splitQuery(search).map(([k]) => k));
  const parsed = parseUrlQuery(search);
  const state: UrlState = { ...parsed.state };

  /* Reading preferences: an explicit query beats a remembered choice beats the
     default. Falling back to 19c and to the host's colour scheme is what keeps
     every link written before this page existed reading the way it did. */
  if (!present.has('theme')) state.theme = loadTheme() ?? URL_DEFAULTS.theme;
  if (!present.has('ed')) state.ed = loadEdition() ?? URL_DEFAULTS.ed;
  applyTheme(state.theme);
  palette.value = loadPalette() ?? 'standard';
  applyPalette();
  /* Whether the reader has already been told how the page works. Read once,
     here, so no component reaches into localStorage while it renders. */
  loadIntro();
  /* And whether they want the sentence under each control. Same contract:
     read once, here, never from inside a render. */
  loadHints();
  loadGrid();
  loadIssuesOpen();
  loadTimelineOpen();
  loadRailCollapsed();
  loadBreakTimeline();
  loadSummaryOpen();
  loadOutcomeDrawing();

  let restoredFromStorage = false;
  let notice: string | null = null;
  /* Set only when the honest answer lives on another page -- see SS6.4. */

  /* 1. the fragment carries a whole document */
  let next: Doc | null = null;
  if (fragmentKind(hash) !== null) {
    const decoded = await decodeFragment(hash);
    if (decoded?.doc) {
      next = decoded.doc;
      if (decoded.source !== 'schema-2') notice = 'Upgraded a configuration from an older link.';
    } else if (decoded) {
      notice = 'That link does not carry a readable configuration; showing the classic one.';
    }
  }

  /* 2. a preset names one.
     `?preset=` is an address for a whole document, so it loads that document
     -- the preset's own, events included -- rather than the classic one. An id
     this build does not carry is said out loud and dropped, so the reader is
     never told they are looking at something they are not. A lesson needs no
     document here: `openLessonStep` below puts the lesson's own baseline in,
     and the classic configuration is what it patches until it does. */
  if (!next && state.preset !== null) {
    const chosen = findPreset(state.preset);
    if (chosen) next = makeDoc(chosen.doc());
    else {
      notice = `There is no preset called "${state.preset}" here; showing the classic configuration.`;
      state.preset = null;
    }
  }
  if (!next && state.lesson !== null) next = startingDoc(state.ed);

  /* 3. a published-page link */
  if (!next) {
    const legacy = upgradeLegacyUrl(search, hash);
    if (legacy) {
      next = { ...classicDoc(state.ed), topology: legacy.topology };
      if (legacy.view.mode) state.mode = legacy.view.mode;
      if (legacy.view.panel) state.panel = legacy.view.panel;
      if (legacy.view.lesson) state.lesson = legacy.view.lesson;
      if (legacy.view.ed && !present.has('ed')) state.ed = legacy.view.ed;
      notice = legacy.notice;
    }
  }

  /* 4. the last autosave */
  if (!next) {
    const saved = loadDoc();
    if (saved?.doc) { next = saved.doc; restoredFromStorage = true; }
  }

  /* 5. the classic 1+1+1 configuration */
  resetHistory(next ?? startingDoc(state.ed));
  presetId.value = state.preset;
  applyUrlState(state);

  /* A lesson step is an address of its own: `#/learn/<lesson>/<step>` on the
     way in, `?lesson=&step=` once the canonical URL is written. Either form
     sets the workbench up for that step, so a link to a step shows what the
     step is about rather than whatever was last open. */
  /* The Introduction, only when it is asked for: `?intro=1`, which is the
     header's brand link. A first visit lands on the Topology workbench like
     any other (ui.md SS3e). Read after `applyUrlState`, which has just put
     `?intro=1` into the signal. */
  introPage.value = introOnBoot({ asked: state.intro });

  const route = applyLearnRoute(hash, 'boot');
  if (route === null && state.lesson !== null) {
    const lesson = lessonById(state.lesson);
    if (lesson) openLessonStep(lesson, state.step, 'boot');
  }

  if (notice !== null) {
    toast.value = { kind: 'info', text: notice };
  }

  const root = document.getElementById('app');
  if (!root) throw new Error('boot: #app is missing from index.html');
  render(<Root />, root);

  if (restoredFromStorage) announceRestore();
  startViewportWatch();
  startLearnRouting();
  startAutosave();
  startUrlSync();
}

void boot();
