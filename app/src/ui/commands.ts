/** One catalogue for the palette and page shortcuts. Domain actions keep their
 * existing guards, undo labels and refusal messages. */
import { PRESETS } from '@/presets';
import { doc, makeDoc } from '@/state/doc';
import { topology, trace } from '@/state/derived';
import { canRedo, canUndo, redo, undo } from '@/state/history';
import { exportDoc, saveEdition, saveTheme, setTimelineH, toggleGrid, toggleHints } from '@/state/persist';
import { replaceWorkingDocument } from '@/state/workspaces';
import {
  appLanesShown, applyTheme, canEdit, clearSelection, edition, floating, inspectorCollapsed,
  inspectorOpen, introOpen, introPage, mode, MODE_LABEL, MODES, nextTheme, panelTab,
  PANEL_LABEL, PANEL_TABS, playing, selection, theme, timelineFull, tNow, toast, viewport,
} from '@/state/view';
import type { WhyState } from './common/WhyPill';
import { ON, off } from './inspector/why';
import { ADD_ACTIONS } from './inspector/adds';
import { tidyLayout } from './inspector/edits';
import { buildActionsFor, openInspectorFor } from './build/actions';
import { actionsFor, applyTemplate, clearEvents, runAction, templates } from './break/events';
import { menuOpen, snapT } from './canvas/EventMenu';
import { canvasPan, handTool } from './canvas/pan';
import { canZoom, fitZoom, WHY_MAX, WHY_MIN, zoomBy } from './canvas/zoom';
import { renaming } from './canvas/place';
import { deleteFromCanvas, WHY_TIDY } from './canvas/CanvasSlot';
import { revealFindings } from './IssuePanel';
import { leaveIntro, openIntro } from './intro/route';
import { requestImport, share } from './StatusBar';
import { openWorkspaces } from './workspaces/Workspaces';
import { openReview } from './review/ReviewPanel';
import { collectOpen } from './import/CollectDialog';
import { exportPng } from './export/diagram';
import { openReport } from './export/Report';
import { buildTimeline } from './timeline/build';
import { nextChange, prevChange } from './timeline/Playhead';

export interface Shortcut { keys: readonly string[]; mod?: boolean; shift?: boolean; }
export interface Command {
  id: string; label: string; group: string; keywords?: string;
  shortcut?: Shortcut; keyLabel?: string; enabled: WhyState; run: () => unknown;
}
const binding = (key: string, mod = false, shift = false): Shortcut => ({ keys: [key], mod, shift });
const entry = (id: string, label: string, group: string, run: () => unknown,
  enabled: WhyState = ON, shortcut?: Shortcut, keyLabel?: string): Command =>
  ({ id, label, group, run, enabled, shortcut, keyLabel });

export function toggleInspector(): void {
  if (viewport.value === 'wide') inspectorCollapsed.value = !inspectorCollapsed.value;
  else inspectorOpen.value = !inspectorOpen.value;
}

export function commands(): Command[] {
  const d = topology.value;
  const working = !introPage.value;
  const drawing = working && (mode.value === 'build' || mode.value === 'break');
  const editable = canEdit(viewport.value) ? ON : off('Editing needs a wider screen.');
  const build = working && mode.value === 'build' ? editable : off('Open Build to edit the topology.');
  const canvas = drawing ? ON : off('Open Build or Break to work with the drawing.');
  const run = working && mode.value === 'break' && trace.value !== null
    ? ON : off('Open Break and add an event first.');
  const docReady = working ? ON : off('Open the workbench first.');
  const picked = selection.value[0];
  const out: Command[] = MODES.map((m, i) => entry(`mode:${m}`, `Open ${MODE_LABEL[m]}`, 'Navigate',
    () => { mode.value = m; leaveIntro(); }, ON, binding(String(i + 1)), String(i + 1)));
  out.push(
    entry('inspector', mode.value === 'break' ? 'Toggle Events panel' : 'Toggle Inspector', 'View',
      toggleInspector, working && mode.value !== 'learn' ? ON : off('Choose Build, Break or Configure.'), binding('i'), 'I'),
    entry('undo', 'Undo', 'Edit', undo, working && canUndo.value ? editable : off('Nothing to undo yet.'), binding('z', true, false), '⌘/Ctrl Z'),
    entry('redo', 'Redo', 'Edit', redo, working && canRedo.value ? editable : off('Nothing undone yet.'), binding('z', true, true), '⌘/Ctrl Shift Z'),
    entry('share', 'Copy share link', 'Document', () => void share(), docReady, binding('s', true, true), '⌘/Ctrl Shift S'),
    entry('export', 'Export configuration as JSON', 'Document', () => exportDoc(doc.value), docReady, binding('e', true, true), '⌘/Ctrl Shift E'),
    entry('import', 'Import configuration file', 'Document', requestImport, working ? editable : docReady, binding('o', true), '⌘/Ctrl O'),
    entry('saved', 'Saved configurations', 'Document', openWorkspaces, docReady, binding('s', true, false), '⌘/Ctrl S'),
    entry('compare', 'Compare alternatives', 'Document', openReview, docReady),
    entry('collect', 'Import existing setup', 'Document', () => { collectOpen.value = true; }, working ? editable : docReady),
    entry('png', 'Export diagram as PNG', 'Document', () => void exportPng(), docReady),
    entry('pdf', 'Open report as PDF', 'Document', () => void openReport(), docReady),
    entry('fit', 'Fit topology to page', 'Canvas', fitZoom, canvas, binding('f'), 'F'),
    entry('zoom-in', 'Zoom in', 'Canvas', () => zoomBy(1), drawing && canZoom(1) ? ON : drawing ? off(WHY_MAX) : canvas,
      { keys: ['+', '='] }, '+'),
    entry('zoom-out', 'Zoom out', 'Canvas', () => zoomBy(-1), drawing && canZoom(-1) ? ON : drawing ? off(WHY_MIN) : canvas, binding('-'), '−'),
    entry('hand', 'Use Hand tool to pan canvas', 'Canvas', () => { handTool.value = true; }, canvas, binding('h'), 'H'),
    entry('select-tool', 'Use selection tool', 'Canvas', () => { handTool.value = false; }, canvas, binding('v'), 'V'),
    entry('select-all', 'Select all topology cards', 'Canvas', () => {
      selection.value = [...d.members.map(m => m.id as string), ...d.observers.map(o => o.id as string),
        ...(d.application ? [d.application.id as string] : [])];
    }, drawing ? editable : canvas, binding('a', true), '⌘/Ctrl A'),
    entry('clear-selection', 'Clear selection', 'Canvas', clearSelection, selection.value.length ? ON : off('Nothing selected.')),
    entry('properties', 'Edit selected object', 'Selection', () => { if (picked) openInspectorFor(picked); },
      picked && working ? editable : off('Select an object first.')),
    entry('rename', 'Rename selected object', 'Selection', () => { if (picked) renaming.value = picked; },
      picked && !d.links.some(l => l.id as string === picked) ? build : off('Select a card or data centre first.'), binding('f2'), 'F2'),
    entry('delete', 'Remove selected objects', 'Selection', () => { if (picked) deleteFromCanvas(picked); },
      picked ? build : off('Select an object first.'), binding('delete'), 'Delete'),
    entry('tidy', 'Tidy topology layout', 'Canvas', () => {
      tidyLayout(selection.value.filter(k => Object.hasOwn(doc.value.layout, k)));
      canvasPan.value = { x: 0, y: 0 };
    }, Object.keys(doc.value.layout).length ? build : off(WHY_TIDY), binding('t', false, true), 'Shift T'),
    entry('grid', 'Toggle dotted background', 'View', toggleGrid, canvas, binding('g'), 'G'),
    entry('hints', 'Toggle hints', 'View', toggleHints, ON, { keys: ['?'] }, '?'),
    entry('help', 'Keyboard shortcuts and help', 'View', () => { introOpen.value = !introOpen.value; }, ON),
    entry('intro', 'Open Introduction', 'Navigate', openIntro),
    entry('findings', 'Show validation findings', 'View', revealFindings, docReady, binding('j'), 'J'),
    entry('theme', 'Toggle light / dark theme', 'View', () => {
      const pref = nextTheme(theme.value); theme.value = pref; saveTheme(pref); applyTheme(pref);
    }),
    ...(['19c', '26ai'] as const).map(ed => entry(`edition:${ed}`, `Use Oracle ${ed}`, 'View',
      () => { edition.value = ed; saveEdition(ed); })),
    entry('play', playing.value ? 'Pause simulation' : 'Play simulation', 'Timeline',
      () => { playing.value = !playing.value; }, run, binding('p'), 'P'),
    entry('events', 'Open event menu', 'Timeline', () => {
      menuOpen.value = true; inspectorCollapsed.value = false;
      if (viewport.value !== 'wide' && !floating(mode.value, viewport.value)) inspectorOpen.value = true;
    }, working && mode.value === 'break' ? editable : run, binding('e'), 'E'),
    entry('full-timeline', 'Toggle full-screen timeline', 'Timeline', () => { timelineFull.value = !timelineFull.value; },
      run.state === 'on' && floating(mode.value, viewport.value) ? ON : off('A timeline in Break on a wider screen is required.'), binding('l'), 'L'),
    entry('reset-timeline', 'Reset timeline height', 'Timeline', () => setTimelineH(null), run),
    entry('application-lanes', 'Toggle application timeline lanes', 'Timeline', () => { appLanesShown.value = !appLanesShown.value; },
      d.application ? run : off('Add an application first.')),
    entry('clear-events', 'Clear injected events', 'Timeline', clearEvents, run.state === 'on' ? editable : run),
  );
  if (trace.value) {
    const model = buildTimeline(trace.value, d, { width: 1000, app: appLanesShown.value });
    const now = model.scale.clampT(tNow.value);
    const seek = (at: number): void => { playing.value = false; tNow.value = at; };
    const prev = prevChange(model.stateChanges, now);
    const next = nextChange(model.stateChanges, now);
    out.push(
      entry('previous', 'Previous state change', 'Timeline', () => { if (prev !== null) seek(prev); },
        prev === null ? off('Already at the start.') : run, binding(','), ','),
      entry('next', 'Next state change', 'Timeline', () => { if (next !== null) seek(next); },
        next === null ? off('No later state change.') : run, binding('.'), '.'),
      entry('restart', 'Back to the start', 'Timeline', () => seek(model.scale.t0), run, binding('home'), 'Home'),
      entry('end', 'Go to timeline end', 'Timeline', () => seek(model.scale.t1), run, binding('end'), 'End'),
    );
  }
  for (const add of ADD_ACTIONS) {
    if (add.offered && !add.offered(d)) continue;
    const key = { database: 'b', farsync: 'f', observer: 'o', application: 'a', site: 'd' }[add.key];
    out.push(entry(`add:${add.key}`, add.label.replace(/^\+ /, 'Add '), 'Add', () => { const key = add.run(); if (key !== null) renaming.value = key; },
      build.state === 'off' ? build : add.enabled(d), key ? binding(key, false, true) : undefined, key ? `Shift ${key.toUpperCase()}` : undefined));
  }
  if (drawing && mode.value === 'build' && selection.value.length) {
    for (const action of buildActionsFor(d, selection.value).filter(a => a.kind === 'prop')) {
      out.push(entry(`selection:${action.id}`, action.label, 'Selection', action.run, editable.state === 'off' ? editable : action.enabled));
    }
  }
  if (working && mode.value === 'break') {
    for (const action of actionsFor(d, selection.value, snapT(tNow.value))) {
      out.push(entry(`event:${action.id}`, action.label, 'Selected events', () => runAction(action), editable.state === 'off' ? editable : action.enabled));
    }
    for (const scenario of templates(d, snapT(tNow.value))) {
      out.push(entry(`scenario:${scenario.id}`, `Scenario: ${scenario.label}`, 'Scenarios', () => applyTemplate(scenario),
        editable.state === 'off' ? editable : scenario.enabled));
    }
  }
  out.push(...PANEL_TABS.map(tab => entry(`panel:${tab}`, `Open ${PANEL_LABEL[tab]}`, 'Configure', () => {
    panelTab.value = tab; mode.value = 'configure'; leaveIntro();
  })));
  out.push(...PRESETS.map(preset => entry(`preset:${preset.id}`, `Open preset: ${preset.short}`, 'Presets', () => {
    replaceWorkingDocument(`Open ${preset.short}`, makeDoc(preset.doc()), preset.id); leaveIntro(); fitZoom();
  }, editable)));
  const inspector = out.find(c => c.id === 'inspector');
  if (inspector) inspector.keywords = 'inspector events collapse expand settings properties';
  return out;
}

export function filterCommands(items: readonly Command[], query: string): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => words.every(word => `${item.label} ${item.group} ${item.keywords ?? ''}`.toLowerCase().includes(word)));
}
export function matchesShortcut(ev: KeyboardEvent, shortcut: Shortcut): boolean {
  return !ev.altKey && (ev.ctrlKey || ev.metaKey) === (shortcut.mod ?? false)
    && (shortcut.shift === undefined || ev.shiftKey === shortcut.shift)
    && shortcut.keys.includes(ev.key.toLowerCase());
}
export function runCommand(id: string): void {
  const action = commands().find(c => c.id === id);
  if (!action) return;
  if (action.enabled.state === 'off') { toast.value = { kind: 'info', text: action.enabled.why }; return; }
  action.run();
}
