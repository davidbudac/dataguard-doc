/**
 * Boot (ui.md SS2.6).
 *
 * Order matters, and every step is a fallback rather than a guess:
 *
 *   theme      ?theme=  ->  localStorage  ->  auto
 *   edition    ?ed=     ->  localStorage  ->  19c
 *   intro card localStorage dg-intro-v1 (shown when it is not set)
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
import { App } from './ui/App';
import { classicDoc, makeDoc } from './state/doc';
import type { Doc } from './state/doc';
import { findPreset } from './presets';
import { resetHistory } from './state/history';
import { decodeFragment, fragmentKind } from './state/codec';
import {
  announceRestore, loadDoc, loadEdition, loadIntro, loadTheme, startAutosave,
} from './state/persist';
import { upgradeLegacyUrl } from './state/legacy-url';
import { applyLearnRoute, openLessonStep, startLearnRouting } from './ui/learn/route';
import { lessonById } from './content';
import {
  applyUrlState, parseUrlQuery, presetId, splitQuery, startUrlSync, URL_DEFAULTS,
} from './state/url';
import type { UrlState } from './state/url';
import { applyTheme, startViewportWatch, toast } from './state/view';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/print.css';

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
  /* Whether the reader has already been told how the page works. Read once,
     here, so no component reaches into localStorage while it renders. */
  loadIntro();

  let restoredFromStorage = false;
  let notice: string | null = null;
  /* Set only when the honest answer lives on another page -- see SS6.4. */
  let noticeLink: { label: string; href: string } | null = null;

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
  if (!next && state.lesson !== null) next = classicDoc(state.ed);

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
      /* `?lang=cs` is not dropped in silence: the Czech reading of this
         document stays on the published page, and the notice links to it.
         It shows once, because the canonical URL written on the first flush no
         longer carries the parameter that produced it. */
      if (legacy.legacyHref !== null) {
        noticeLink = { label: 'Open the Czech page', href: legacy.legacyHref };
      }
    }
  }

  /* 4. the last autosave */
  if (!next) {
    const saved = loadDoc();
    if (saved?.doc) { next = saved.doc; restoredFromStorage = true; }
  }

  /* 5. the classic 1+1+1 configuration */
  resetHistory(next ?? classicDoc(state.ed));
  presetId.value = state.preset;
  applyUrlState(state);

  /* A lesson step is an address of its own: `#/learn/<lesson>/<step>` on the
     way in, `?lesson=&step=` once the canonical URL is written. Either form
     sets the workbench up for that step, so a link to a step shows what the
     step is about rather than whatever was last open. */
  const route = applyLearnRoute(hash, 'boot');
  if (route === null && state.lesson !== null) {
    const lesson = lessonById(state.lesson);
    if (lesson) openLessonStep(lesson, state.step, 'boot');
  }

  if (notice !== null) {
    toast.value = { kind: 'info', text: notice, ...(noticeLink ? { link: noticeLink } : {}) };
  }

  const root = document.getElementById('app');
  if (!root) throw new Error('boot: #app is missing from index.html');
  render(<App />, root);

  if (restoredFromStorage) announceRestore();
  startViewportWatch();
  startLearnRouting();
  startAutosave();
  startUrlSync();
}

void boot();
