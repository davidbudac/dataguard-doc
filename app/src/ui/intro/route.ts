/**
 * Getting to the Introduction, and getting out of it with something loaded
 * (ui.md SS3e).
 *
 * The page's buttons never merely switch a mode: each one loads the document
 * it is talking about first and switches after, exactly as a lesson step does
 * (`learn/route.ts`, `openStepInMode`). A button that promised a failover and
 * landed the reader in Break over whatever happened to be open would be worse
 * than no button.
 *
 * Nothing here draws. It is the one place that knows what "Start building"
 * and each "Try it" mean, so the page below and a future link can never
 * disagree about them.
 */

import type { ClassicScenario } from '@/engine';
import { LESSONS } from '@/content';
import { findPreset } from '@/presets';
import type { PresetId } from '@/presets';
import { makeDoc } from '@/state/doc';
import { topology } from '@/state/derived';
import { replaceWorkingDocument } from '@/state/workspaces';
import { dismissIntro } from '@/state/persist';
import { introOpen, introPage, mode, panelTab } from '@/state/view';
import type { Mode, PanelTab } from '@/state/view';
import { applyTemplate, templates } from '@/ui/break/events';
import { openLessonStep } from '@/ui/learn/route';

/** The canonical address of the page, for every `href` that points at it. */
export const INTRO_HREF = '?intro=1';

/** Show the Introduction. Reading it again is not a reason to be owed it. */
export function openIntro(): void {
  introPage.value = true;
  /* The `?` card and the page say the same things; two of them open at once
     is one of them too many. */
  introOpen.value = false;
}

/**
 * Leave it, and record that the reader has seen it.
 *
 * `dg-intro-v1` is the same key the dismissed "How this page works" strip
 * wrote: what it now means is "this reader has been shown the Introduction".
 * Nothing opens the page on its own any more -- boot gates on `?intro=1`
 * alone -- so the key is a record, not a rule. The page is one press of the
 * header link away.
 */
export function leaveIntro(): void {
  introPage.value = false;
  dismissIntro();
}

/* ---------------- what the buttons do ---------------- */

/** Load a preset the way the status bar's picker does: whole document, events and all. */
export function loadPreset(id: PresetId): void {
  const chosen = findPreset(id);
  if (!chosen) return;
  /* The same path as the picker: undoable, and the draft it replaces is kept. */
  replaceWorkingDocument(`Open ${chosen.short}`, makeDoc(chosen.doc()), id);
}

export interface IntroJump {
  /** The configuration to talk about. Omitted leaves the document alone. */
  preset?: PresetId;
  /** One of the six Break templates, applied on top of that preset. */
  scenario?: ClassicScenario;
  mode: Mode;
  /** Which Configure tab to open on. */
  panel?: PanelTab;
}

/**
 * Load, break, and only then switch: the mode is the last thing set, so the
 * drawing a reader lands on is the one the button named.
 */
export function jump(j: IntroJump): void {
  if (j.preset !== undefined) loadPreset(j.preset);
  if (j.scenario !== undefined) {
    /* Read back through `topology`, not from the preset factory: the edition
       is stamped on there, and a template is built against the document the
       reader will actually be looking at. */
    const t = templates(topology.value).find((x) => x.id === j.scenario);
    /* A template that cannot fire is simply not applied -- it carries its own
       refusal, and this page has no room to argue with it. */
    if (t) applyTemplate(t);
  }
  if (j.panel !== undefined) panelTab.value = j.panel;
  mode.value = j.mode;
  leaveIntro();
}

/** Open one lesson by its position in the reading order, at its first step. */
export function openLesson(index: number): void {
  const lesson = LESSONS[index];
  if (!lesson) return;
  openLessonStep(lesson, 0, 'live');
  leaveIntro();
}

/* ---------------- boot ---------------- */

export interface BootIntro {
  /** `?intro=1` was asked for outright. */
  asked: boolean;
}

/**
 * Whether boot should open the Introduction. Pure, so the rule is testable.
 *
 * Only when it is asked for. A first visit lands on the Topology workbench:
 * the page is one press of the header's "Data Guard" link away, and that link
 * is a real `?intro=1` href, so it also survives a reload or a middle-click.
 */
export function introOnBoot(b: BootIntro): boolean {
  return b.asked;
}
