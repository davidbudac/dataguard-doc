/**
 * The inspector: the five invariants it is answerable for.
 *
 * A disabled control carries its reason, the RedoRoutes editor speaks the
 * property rather than a paraphrase of it, adding a member leaves a document
 * the engine can still parse, and nothing in the rail writes an inline style
 * -- the page ships under `style-src 'self'`.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import {
  BOUNDS, declaredPrimary, formatRedoRoutes, isTopologyDoc, parseTopologyDoc, resolveRedoGraph,
  validate,
} from '@/engine';
import type { DatabaseMember, MemberId } from '@/engine';
import { hostId, memberId, observerId, siteId } from '@/engine';
import { classicDoc, doc, makeDoc } from '@/state/doc';
import { presetDoc } from '@/presets';
import { resetHistory, undo } from '@/state/history';
import { errors } from '@/state/derived';
import {
  clearSelection, edition, hintsOn, issuesOpen, lessonId, lessonStep, mode, notesOpen, selection,
  toast, viewport,
} from '@/state/view';
import { CanvasSlot } from '@/ui/canvas/CanvasSlot';
import { Inspector } from '@/ui/inspector/Inspector';
import { IssuePanel, revealFindings } from '@/ui/IssuePanel';
import { layoutTopology, roleWord } from '@/ui/canvas/layout';
import {
  addDatabase, addFarSync, addLink, addObserver, addSite, removeSite, renameMember,
  renameObserver, setPrimary,
} from '@/ui/inspector/edits';
import { ADD_ACTIONS, AddToolbar, WHY_NO_SITE, WHY_ONE_SITE } from '@/ui/inspector/adds';
import {
  DEFAULT_OPEN, isSectionOpen, openSections, resetSections, SECTION_IDS, sectionOfRule,
} from '@/ui/inspector/sections';
import { WHY } from '@/ui/inspector/why';
import { printing } from '@/ui/print';

/**
 * A Storage this environment does not otherwise have: jsdom hands back a bare
 * object with no methods here, so persistence has nothing to write to.
 */
const memory = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => { memory.clear(); },
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
} as unknown as Storage;
Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });

const mount =(component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const mountWith = (component: unknown, props: Record<string, unknown>): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, props), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const whyTexts = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.why')].map((el) => el.textContent ?? '');

/** The one-line "these rows cannot apply, and why" notes (controls.tsx, `Withheld`). */
const withheldTexts = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.is-withheld')].map((el) => el.textContent ?? '');

/** The fold's toggle, found the way a reader finds it: by its section label. */
const foldTog = (root: HTMLElement, title: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')]
    .find((b) => b.querySelector('.eyebrow')?.textContent === title);

const unfold = async (root: HTMLElement, title: string): Promise<void> => {
  foldTog(root, title)?.click();
  await tick();
};

const buttonLabels = (root: HTMLElement, sel: string): string[] =>
  [...root.querySelectorAll<HTMLButtonElement>(sel)].map((b) => b.textContent ?? '');

const member = (id: string): DatabaseMember =>
  doc.value.topology.members.find((m) => (m.id as string) === id) as DatabaseMember;

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  edition.value = '19c';
  notesOpen.value = false;
  toast.value = null;
  lessonId.value = null;
  lessonStep.value = 0;
  resetSections();
  hintsOn.value = false;
  clearSelection();
});

describe('the WhyPill contract', () => {
  it('gives a disabled control a reason, in words, beside it', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    /* The primary applies no redo, so its four apply and lag rows cannot
       apply -- for the one reason, so they are not four grey rows under a pill
       apiece: they are one line, which says why rather than greying out in
       silence. */
    expect(withheldTexts(root)).toEqual([
      `Apply lag, transport lag, redo apply and real-time apply: ${WHY.primaryNoApply}`,
    ]);
    const names = [...root.querySelectorAll('.field-name')].map((el) => el.textContent);
    for (const gone of ['Apply lag', 'Transport lag', 'Apply running', 'Real-time apply']) {
      expect(names).not.toContain(gone);
    }
    expect(whyTexts(root)).not.toContain(WHY.primaryNoApply);
  });

  it('keeps a control that is off for a reason of its own, grey, with its pill', async () => {
    /* A snapshot standby applies nothing, so "Apply running" is off for a
       reason the standby's other apply rows do not share: it stays where it
       is, with the pill. */
    const t = doc.value.topology;
    resetHistory({
      ...doc.value,
      topology: {
        ...t,
        members: t.members.map((m) => (m.kind === 'database' && (m.id as string) === 'sby01'
          ? { ...m, role: 'snapshot' as const }
          : m)),
      },
    });
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    const off = root.querySelector('.field.is-off');
    expect(off?.querySelector('.field-name')?.textContent).toBe('Apply running');
    expect(off?.querySelector('.why')?.textContent).toBe(WHY.snapshotNoApply);
    expect(withheldTexts(root)).toEqual([]);
  });

  it('never leaves a disabled input without one', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    for (const el of root.querySelectorAll('.field.is-off')) {
      expect(el.querySelector('.why')?.textContent ?? '').not.toBe('');
    }
  });

  it('gates FastStartFailoverLagLimit on the release, and says which', async () => {
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    /* 19c, maximum availability: the limit is a maximum performance property
       there, and 26ai is the edition that gives it another role. */
    expect(whyTexts(root)).toContain(WHY.lagLimitMaxAvail19c);
    edition.value = '26ai';
    await tick();
    expect(whyTexts(root)).not.toContain(WHY.lagLimitMaxAvail19c);
  });

  it('never gates PreferredObserverHosts on the release: it is documented since 12.2', async () => {
    /* ED-05: the property is on the 12.2, 18c and 19c property pages and in
       a live 19.27 system -- never grey this control under 19c. */
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'PreferredObserverHosts');
    expect(whyTexts(root)).not.toContain(WHY.needs26ai);
    const addHost = [...root.querySelectorAll('.field-name')]
      .find((el) => el.textContent === 'Add a host');
    expect(addHost?.closest('.field')?.classList.contains('is-off')).toBe(false);
    edition.value = '26ai';
    await tick();
    expect(whyTexts(root)).not.toContain(WHY.needs26ai);
  });

  it('gates ObserverPingInterval/Retry on the release: neither exists in 19c (ED-01)', async () => {
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    /* The switch and both values are off for the one reason: one line. */
    expect(withheldTexts(root)).toContain(
      `ObserverPingInterval, ObserverPingRetry: ${WHY.pingPropsNotIn19c}`,
    );
    expect(root.querySelector('input[aria-label="ObserverPingInterval"]')).toBeNull();
    edition.value = '26ai';
    await tick();
    expect(root.textContent).not.toContain(WHY.pingPropsNotIn19c);
    /* Unset under 26ai, the two values are off for a reason of their own --
       and still one line, not two rows. */
    expect(withheldTexts(root)).toContain(`ObserverPingInterval, ObserverPingRetry: ${WHY.pingUnset}`);
    expect(root.querySelector('input[aria-label="Both properties are explicitly set"]')).not.toBeNull();
  });

  it('gates LagType/LagGraceTime and PrimaryDatabaseCandidates on the release (ED-02)', async () => {
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    await unfold(root, 'PrimaryDatabaseCandidates');
    /* LagType and LagGraceTime carry the reason as one withheld line; the
       checkbox list for PrimaryDatabaseCandidates carries it as the fold's own
       note. All three are present under 19c because the properties are documented
       from 26ai and absent from the 19c and 21c properties references, even
       though a live 19.27 system carries all three. */
    expect(withheldTexts(root)).toContain(
      `FastStartFailoverLagType, FastStartFailoverLagGraceTime: ${WHY.docLater26aiObservedIn1927}`,
    );
    expect(root.textContent).toContain(WHY.docLater26aiObservedIn1927);
    edition.value = '26ai';
    await tick();
    expect(whyTexts(root)).not.toContain(WHY.docLater26aiObservedIn1927);
    expect(root.textContent).not.toContain(WHY.docLater26aiObservedIn1927);
  });

  it('gates FASTSYNC on the protection mode', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    /* The classic configuration runs maximum availability, where FASTSYNC is
       legal, so nothing is grey for that reason. */
    expect(whyTexts(root)).not.toContain(WHY.fastsyncMode);
    resetHistory({
      ...doc.value,
      topology: {
        ...doc.value.topology,
        config: { ...doc.value.topology.config, protectionMode: 'MAXPERFORMANCE' },
      },
    });
    await tick();
    expect(whyTexts(root)).toContain(WHY.fastsyncMode);
  });

  it('says it once when a whole control is off, not once per option', async () => {
    /* FastStartFailoverLagType is documented as maximum performance mode
       behaviour, and the classic configuration runs maximum availability.
       Under 26ai, so the edition gate (ED-02) does not also apply and mask
       the mode-based reason this test is about. */
    edition.value = '26ai';
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    const field = [...root.querySelectorAll('.field.is-off')]
      .find((el) => (el.textContent ?? '').includes('FastStartFailoverLagType'));
    expect(field).toBeDefined();
    expect(field?.querySelectorAll('.why')).toHaveLength(1);
    expect(field?.querySelector('.why')?.textContent).toBe(WHY.lagTypeMode);
    expect(field?.querySelectorAll('.seg button[disabled]')).toHaveLength(2);
  });

  it('writes no inline style anywhere in the rail', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });
});

describe('the RedoRoutes editor', () => {
  it('round-trips (LOCAL : FS1 SYNC) through the property field', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('');

    (input as HTMLInputElement).value = '(LOCAL : FS1 SYNC)';
    (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    const rules = member('prm01').redoRoutes;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('LOCAL');
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : FS1 SYNC)');
    const after = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    expect(after?.value).toBe('(LOCAL : FS1 SYNC)');
  });

  it('round-trips a PRIORITY group', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    const text = '(LOCAL : (FS1 SYNC PRIORITY=1), (sby01 ASYNC PRIORITY=2))';
    (input as HTMLInputElement).value = text;
    (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(formatRedoRoutes(member('prm01').redoRoutes)).toBe(text);
    expect(member('prm01').redoRoutes[0]?.groups).toHaveLength(2);
  });

  it('keeps a PRIORITY on each destination of one group (Oracle Example 1)', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    (input as HTMLInputElement).value = '(local : ( FS1 PRIORITY=1, sby01 PRIORITY=2 ) )';
    (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(formatRedoRoutes(member('prm01').redoRoutes)).toBe('(LOCAL : (FS1 PRIORITY=1, sby01 PRIORITY=2))');
    const second = root.querySelector<HTMLSelectElement>('select[aria-label="Rule 1 destination 2 priority"]');
    expect(second?.value).toBe('2');
  });

  it('edits PRIORITY per destination, and a PRIORITY puts its group in parentheses', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    (input as HTMLInputElement).value = '(LOCAL : FS1 SYNC, sby01 ASYNC)';
    (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const paren = root.querySelector<HTMLInputElement>('input[aria-label="Rule 1 group 1 in parentheses"]');
    expect(paren?.checked).toBe(false);

    const prio = root.querySelector<HTMLSelectElement>('select[aria-label="Rule 1 destination 2 priority"]');
    (prio as HTMLSelectElement).value = '2';
    (prio as HTMLSelectElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(formatRedoRoutes(member('prm01').redoRoutes)).toBe('(LOCAL : (FS1 SYNC, sby01 ASYNC PRIORITY=2))');

    /* Out of the parentheses, the PRIORITY goes with them: it is written inside them only. */
    const paren2 = root.querySelector<HTMLInputElement>('input[aria-label="Rule 1 group 1 in parentheses"]');
    expect(paren2?.checked).toBe(true);
    (paren2 as HTMLInputElement).checked = false;
    (paren2 as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(formatRedoRoutes(member('prm01').redoRoutes)).toBe('(LOCAL : FS1 SYNC, sby01 ASYNC)');
  });

  it('refuses what it cannot parse, and says so without changing the property', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="RedoRoutes property"]');
    (input as HTMLInputElement).value = '(LOCAL FS1';
    (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(member('prm01').redoRoutes).toHaveLength(0);
    expect(root.textContent).toContain('RedoRoutes:');
  });
});

/**
 * The rail opens on the way to add something, and the long property groups
 * fold. What is folded is genuinely absent, and what a fold hides is one press
 * away from any of the three surfaces that offer the same additions.
 */
describe('the foldable configuration groups', () => {
  it('opens with Configuration and folds the other four away', async () => {
    const root = mount(Inspector);
    await tick();
    const togs = [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')];
    /* There is no summary above them: the rail opens on the five, with the
       protection mode's section the one that is open. */
    expect(togs.map((b) => b.querySelector('.eyebrow')?.textContent))
      .toEqual([...SECTION_IDS]);
    expect(togs.map((b) => b.getAttribute('aria-expanded')))
      .toEqual(['true', 'false', 'false', 'false', 'false']);
    /* Folded means absent, not painted out of view (ui.md SS8). */
    expect(root.querySelector('input[aria-label="FastStartFailoverThreshold"]')).toBeNull();
    expect(root.querySelector('input[aria-label="Redo rate"]')).toBeNull();
    /* The protection mode is inside the one that is open. */
    expect(root.querySelector('.seg button[aria-pressed="true"]')).not.toBeNull();
  });

  it('says what is inside a fold while it is shut, and stops when it is open', async () => {
    const root = mount(Inspector);
    await tick();
    const fsfo = (): HTMLButtonElement => foldTog(root, 'Fast-start failover') as HTMLButtonElement;
    expect(fsfo().querySelector('.grp-sum')?.textContent).toContain('ENABLED');
    expect(fsfo().querySelector('.grp-sum')?.textContent).toContain('sby01');
    await unfold(root, 'Fast-start failover');
    expect(fsfo().querySelector('.grp-sum')).toBeNull();
  });

  it('is a real disclosure: the button toggles and the content comes and goes', async () => {
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Environment');
    expect(foldTog(root, 'Environment')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('input[aria-label="Redo rate"]')).not.toBeNull();
    await unfold(root, 'Environment');
    expect(foldTog(root, 'Environment')?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('input[aria-label="Redo rate"]')).toBeNull();
  });

  it('opens the section an error is about, and lets the reader shut it again', async () => {
    /* A far sync instance named as the fast-start failover target is
       FSFO.TARGET_KIND, an error against a property of that group -- and a
       fold that hid the property the validator is complaining about would be
       the page hiding its own answer. */
    openSections.value = new Set<string>();
    addFarSync();
    clearSelection();
    const cur = doc.value;
    resetHistory({
      ...cur,
      topology: {
        ...cur.topology,
        config: {
          ...cur.topology.config,
          fsfo: {
            ...cur.topology.config.fsfo,
            target: { kind: 'list', members: [memberId('fs01')] },
          },
        },
      },
    });
    const root = mount(Inspector);
    await tick();
    expect(errors.value.map((f) => f.id)).toContain('FSFO.TARGET_KIND');
    expect(foldTog(root, 'Fast-start failover')?.getAttribute('aria-expanded')).toBe('true');
    /* Opened once, not held open: the toggle is never a button that refuses. */
    await unfold(root, 'Fast-start failover');
    expect(foldTog(root, 'Fast-start failover')?.getAttribute('aria-expanded')).toBe('false');

    /* And it stays shut. `ConfigForm` is rendered only while nothing is
       selected, so a click on any card unmounts it and clearing the selection
       mounts a fresh one -- and a remount is not a new error. */
    selection.value = ['sby01'];
    await tick();
    expect(foldTog(root, 'Fast-start failover')).toBeUndefined();
    clearSelection();
    await tick();
    expect(foldTog(root, 'Fast-start failover')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('unfolds every section on paper -- there is no toggle to press on a printout', async () => {
    printing.value = true;
    try {
      const root = mount(Inspector);
      await tick();
      expect([...root.querySelectorAll('button.grp-tog')]
        .map((b) => b.getAttribute('aria-expanded')))
        .toEqual([...SECTION_IDS].map(() => 'true'));
      expect(root.querySelector('input[aria-label="Redo rate"]')).not.toBeNull();
    } finally {
      printing.value = false;
    }
  });

  it('keeps the fold state out of the Document, so it is not undoable', async () => {
    const root = mount(Inspector);
    await tick();
    const before = doc.value;
    await unfold(root, 'Environment');
    expect(doc.value).toBe(before);
  });
});

describe('adding happens in one place', () => {
  it('opens the empty rail on the configuration, with nothing to add and no summary', async () => {
    /* The rail used to open on a palette of the same four buttons the toolbar
       over the drawing carries, and then on a "Configuration summary" fold of
       what the drawing already shows. Neither is here: the toolbar is the one
       surface that adds (ui.md SS3i), and the rail opens on the properties. */
    const root = mount(Inspector);
    await tick();
    const eyebrows = [...root.querySelectorAll('.eyebrow')].map((el) => el.textContent);
    expect(eyebrows[0]).toBe('Configuration');
    expect(eyebrows).not.toContain('Add');
    expect(eyebrows).not.toContain('Configuration summary');
    expect(root.querySelector('.sum')).toBeNull();
    expect(root.querySelector('.pal')).toBeNull();
  });

  it('opens nothing when the reader asks for the explanations: the sentences only appear', async () => {
    const root = mount(Inspector);
    await tick();
    const open = (): string[] => [...root.querySelectorAll('button.grp-tog')]
      .map((b) => b.getAttribute('aria-expanded') ?? '');
    const before = open();
    hintsOn.value = true;
    await tick();
    expect(open()).toEqual(before);
    expect(root.querySelector('.sum')).toBeNull();
    expect(root.querySelector('.insp-note')).not.toBeNull();
    hintsOn.value = false;
  });

  it('offers the five additions on the drawing, each saying what it does', async () => {
    const stage = mountWith(AddToolbar, { doc: doc.value.topology });
    await tick();
    /* There can be any number of applications: with one on the drawing the
       button is still there, and never grey for that reason. */
    expect(doc.value.topology.applications).toHaveLength(1);
    expect(buttonLabels(stage, '.cv-add .btn')).toEqual(ADD_ACTIONS.map((a) => a.short));
    for (const b of stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.disabled).toBe(false);
    }
    const { applications: _none, ...bare } = doc.value.topology;
    const without = mountWith(AddToolbar, { doc: bare });
    await tick();
    expect(buttonLabels(without, '.cv-add .btn')).toEqual(ADD_ACTIONS.map((a) => a.short));
    expect(stage.querySelector('.cv-add')?.getAttribute('role')).toBe('toolbar');
  });

  it('refuses in words when there is no data centre', async () => {
    const base = classicDoc();
    const bare = { ...base.topology, sites: [], hosts: [], links: [], members: [], observers: [] };
    resetHistory({ ...base, topology: bare, layout: {} });

    const stage = mountWith(AddToolbar, { doc: bare });
    await tick();
    const offOnStage = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')]
      .filter((b) => b.disabled);
    expect(offOnStage).toHaveLength(4);
    for (const b of offOnStage) {
      expect(b.parentElement?.querySelector('.why')?.textContent).toBe(WHY_NO_SITE);
    }
    /* A data centre is the one addition that never needs one. */
    expect(buttonLabels(stage, '.cv-add .btn:not(:disabled)')).toEqual(['+ Data centre']);
  });

  it('links a data centre from its own form, to each one it is not linked to yet', async () => {
    const base = classicDoc();
    const t = base.topology;
    resetHistory({
      ...base,
      topology: { ...t, links: t.links.filter((l) => (l.id as string) !== 'dc2-dc3') },
      layout: {},
    });
    selection.value = ['dc2'];
    const root = mount(Inspector);
    await tick();
    /* The links are a fold of their own, shut to start with, and its hint says
       how many are made. */
    expect(foldTog(root, 'Links')?.querySelector('.grp-sum')?.textContent).toBe('1 of 2 linked');
    await unfold(root, 'Links');
    const rows = () => [...root.querySelectorAll<HTMLElement>('.rr-dest')]
      .filter((r) => r.querySelector('.btn')?.textContent === '+ Link' || r.querySelector('.tag')?.textContent === 'linked');
    const nameOf = (id: string): string => t.sites.find((x) => (x.id as string) === id)?.name ?? id;
    const rowFor = (id: string) => rows().find((r) => r.querySelector('.mono')?.textContent === nameOf(id));
    expect(rowFor('dc1')?.querySelector('.tag')?.textContent).toBe('linked');
    const add = rowFor('dc3')?.querySelector<HTMLButtonElement>('.btn');
    expect(add?.textContent).toBe('+ Link');
    expect(add?.getAttribute('title')).toBeTruthy();
    add?.click();
    await tick();
    expect(doc.value.topology.links.some((l) => l.scope === 'site'
      && (l.ends as [string, string]).includes('dc2') && (l.ends as [string, string]).includes('dc3'))).toBe(true);
    /* The new link is selected, so its round trip is the next thing in reach. */
    expect(selection.value).toEqual(['dc2-dc3']);
  });

  it('says a lone data centre has nothing to link to, rather than offering a blank end', async () => {
    const base = classicDoc();
    const one = {
      ...base.topology,
      sites: base.topology.sites.slice(0, 1),
      hosts: [], links: [], members: [], observers: [],
    };
    resetHistory({ ...base, topology: one, layout: {} });
    selection.value = [one.sites[0]!.id as string];
    const root = mount(Inspector);
    await tick();
    expect(foldTog(root, 'Links')?.querySelector('.grp-sum')?.textContent).toBe('none possible');
    await unfold(root, 'Links');
    expect(root.textContent).toContain(WHY_ONE_SITE);
    expect(buttonLabels(root, '.btn')).not.toContain('+ Link');
  });

  it('is one tab stop with arrow keys, which is what `role="toolbar"` promises', async () => {
    const { applications: _none, ...bare } = doc.value.topology;
    const stage = mountWith(AddToolbar, { doc: bare });
    await tick();
    const btns = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')];
    const stops = () => btns.map((b) => b.getAttribute('tabindex'));
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);

    const bar = stage.querySelector<HTMLElement>('.cv-add') as HTMLElement;
    const arrow = (key: string): void => {
      bar.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    arrow('ArrowRight');
    await tick();
    expect(stops()).toEqual(['-1', '0', '-1', '-1', '-1']);
    expect(document.activeElement).toBe(btns[1]);
    arrow('End');
    await tick();
    expect(stops()).toEqual(['-1', '-1', '-1', '-1', '0']);
    arrow('ArrowRight');
    await tick();
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
    arrow('Home');
    await tick();
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
  });

  it('never parks the one tab stop on a button that cannot take focus', async () => {
    const base = classicDoc();
    const bare = { ...base.topology, sites: [], hosts: [], links: [], members: [], observers: [] };
    const stage = mountWith(AddToolbar, { doc: bare });
    await tick();
    const btns = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')];
    /* The four that need a data centre are off; `+ Data centre` never is, so
       the strip is always reachable by Tab. */
    expect(btns.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1', '0']);
    expect(btns.find((b) => b.getAttribute('tabindex') === '0')?.disabled).toBe(false);
  });

  it('draws the toolbar on the stage in Build, and nowhere else', async () => {
    const stage = mountWith(CanvasSlot, {});
    await tick();
    expect(stage.querySelector('.cv-add')).not.toBeNull();
    /* Break, Configure and Learn do not add; nor does the read-only viewer. */
    for (const m of ['break', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(stage.querySelector('.cv-add'), `${m} draws no add toolbar`).toBeNull();
    }
    mode.value = 'build';
    viewport.value = 'narrow';
    await tick();
    expect(stage.querySelector('.cv-add')).toBeNull();
  });

  it('puts the removal in the header, beside the name, and nothing to add', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    /* The header's actions are Hints and Remove. What closes the rail is the
       rail bar's button above it, not a second one here. */
    const head = buttonLabels(root, '.insp-hd .btn');
    expect(head).toEqual(['Hints', 'Remove']);
    expect(root.querySelector('.insp-hd .insp-clear, .insp-hd .insp-close')).toBeNull();
    expect(root.querySelector('.pal')).toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('.insp-hd .btn')]
      .find((b) => b.textContent === 'Remove')?.click();
    await tick();
    expect(doc.value.topology.members.map((m) => m.id as string)).not.toContain('sby01');
  });

  it('says why a removal is refused on the button, not in a box under the header', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.insp-hd .btn')]
      .find((b) => b.textContent === 'Remove');
    expect(btn?.disabled).toBe(true);
    expect(btn?.title).toContain(WHY.primaryMember);
    const described = btn?.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    const why = root.querySelector(`#${described}`);
    expect(why?.textContent).toBe(WHY.primaryMember);
    /* Visually hidden, and the only place the sentence is on the rail. */
    expect(why?.classList.contains('sr')).toBe(true);
    expect(root.querySelector('.insp-why')).toBeNull();
    expect(root.querySelectorAll('.why').length).toBe(0);
  });
});

describe('the palette', () => {
  it('adds a standby and leaves a document the engine still parses', () => {
    const before = doc.value.topology.members.length;
    const id = addDatabase();
    expect(id).not.toBeNull();
    const t = doc.value.topology;
    expect(t.members).toHaveLength(before + 1);
    expect(isTopologyDoc(t)).toBe(true);
    expect(parseTopologyDoc(JSON.parse(JSON.stringify(t))).ok).toBe(true);

    /* On a host of its own, in a data centre that had no database. */
    const added = t.members.find((m) => m.id === id) as DatabaseMember;
    expect(added.instances).toHaveLength(1);
    const host = t.hosts.find((h) => h.id === added.instances[0]?.host);
    expect(host).toBeDefined();
    expect(t.members.filter((m) => m.instances.some((i) => i.host === host?.id))).toHaveLength(1);

    /* The primary carries destination properties for it, and the redo graph
       reaches it through the NULL RedoRoutes default of (LOCAL : ALL). */
    const primary = t.members.find((m) => m.kind === 'database' && m.role === 'primary');
    expect(primary?.dests[id as MemberId]).toBeDefined();
    const graph = resolveRedoGraph(t, { primary: memberId('prm01') });
    expect(graph.members[id as MemberId]?.reachableFromPrimary).toBe(true);
    expect(() => validate(t)).not.toThrow();
  });

  it('adds a far sync instance with no role and no apply', () => {
    const id = addFarSync();
    const m = doc.value.topology.members.find((x) => x.id === id);
    expect(m?.kind).toBe('farsync');
    expect(m && 'role' in m).toBe(false);
    expect(isTopologyDoc(doc.value.topology)).toBe(true);
  });

  it('gives a new observer a host of its own', () => {
    const id = addObserver();
    const t = doc.value.topology;
    const o = t.observers.find((x) => x.id === id);
    expect(o).toBeDefined();
    expect(o?.role).toBe('backup');
    const dbHosts = new Set(t.members.flatMap((m) => m.instances.map((i) => i.host as string)));
    expect(dbHosts.has(o?.host as string)).toBe(false);
    expect(isTopologyDoc(t)).toBe(true);
  });

  it('is one undo per addition', () => {
    const before = doc.value.topology.members.length;
    addDatabase();
    undo();
    expect(doc.value.topology.members).toHaveLength(before);
  });

  it('mints a data centre id nothing else has, however often it is pressed', () => {
    /* The presets name their sites `dc1..dc3`, and ids are one namespace: a
       second `dc1` is a card that cannot be selected or removed on its own,
       and `removeSite('dc1')` would take both. */
    expect(doc.value.topology.sites.map((s) => s.id as string)).toEqual(['dc1', 'dc2', 'dc3']);
    addSite();
    addSite();
    const t = doc.value.topology;
    expect(t.sites.map((s) => s.id as string)).toEqual(['dc1', 'dc2', 'dc3', 'dc4', 'dc5']);

    const ids = [
      ...t.sites.map((s) => s.id as string),
      ...t.hosts.map((h) => h.id as string),
      ...t.members.map((m) => m.id as string),
      ...t.observers.map((o) => o.id as string),
      ...t.links.map((l) => l.id as string),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    /* And no link from a data centre to itself. */
    for (const l of t.links) expect((l.ends as [string, string])[0]).not.toBe((l.ends as [string, string])[1]);
    expect(isTopologyDoc(t)).toBe(true);
  });

  it('fills a gap in the data centre names, and steps over a name something else holds', () => {
    const base = classicDoc();
    /* dc2 is gone from the sites and its name is now a host's. The next data
       centre is the first name free in the *whole* namespace, not the first
       free site name -- `dc2` would be a second card answering to one id. */
    const gapped = {
      ...base.topology,
      sites: base.topology.sites.filter((s) => (s.id as string) !== 'dc2'),
      hosts: [...base.topology.hosts, {
        id: hostId('dc2'), name: 'dc2', site: siteId('dc1'), listenerPort: 1521,
      }],
      members: [], observers: [], links: [],
    };
    resetHistory({ ...base, topology: gapped, layout: {} });

    addSite();
    const t = doc.value.topology;
    expect(t.sites.map((s) => s.id as string)).toEqual(['dc1', 'dc3', 'dc4']);
    const ids = [
      ...t.sites.map((s) => s.id as string),
      ...t.hosts.map((h) => h.id as string),
      ...t.links.map((l) => l.id as string),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a link with an end this document does not have', () => {
    const before = doc.value.topology.links.length;
    expect(addLink(siteId('dc1'), siteId('nowhere'))).toBeNull();
    expect(doc.value.topology.links).toHaveLength(before);
  });
});

describe('identity and roles', () => {
  it('rewrites every reference when a member is renamed', () => {
    renameMember(memberId('sby01'), 'stby01');
    const t = doc.value.topology;
    expect(t.members.map((m) => m.id as string)).toContain('stby01');
    expect(t.config.fsfo.target).toEqual({ kind: 'list', members: ['stby01'] });
    const primary = t.members.find((m) => m.kind === 'database' && m.role === 'primary');
    expect(Object.keys(primary?.dests ?? {})).toContain('stby01');
    expect(isTopologyDoc(t)).toBe(true);
  });

  it('keeps showing the current name on the card after a rename -- the big title, not just the id', () => {
    /* The gap that let the title silently keep saying "Physical standby":
       every earlier test here only checked the document's own ids, which the
       rename always got right. The card's big title is a separate, derived
       fact -- `layoutTopology`'s `lines.name` -- and this is the one place
       that reads it back out after the edit, the way a reader looking at the
       drawing would. */
    renameMember(memberId('sby01'), 'stby01');
    const t = doc.value.topology;
    const primary = declaredPrimary(t);
    if (primary === null) throw new Error('no primary');
    const graph = resolveRedoGraph(t, { primary });
    const geo = layoutTopology(t, graph);
    const renamed = t.members.find((m) => (m.id as string) === 'stby01')!;
    const node = geo.byKey['stby01'];
    expect(node).toBeDefined();
    expect(node?.lines.name).toBe('stby01');
    expect(node?.lines.sub).toBe(roleWord(renamed));
  });

  it('keeps showing the current name on an observer\'s card after a rename', () => {
    renameObserver(observerId('obs01'), 'watcher01');
    const t = doc.value.topology;
    const primary = declaredPrimary(t);
    if (primary === null) throw new Error('no primary');
    const graph = resolveRedoGraph(t, { primary });
    const geo = layoutTopology(t, graph);
    const node = geo.byKey['watcher01'];
    expect(node).toBeDefined();
    expect(node?.lines.name).toBe('watcher01');
  });

  it('refuses a name another member already carries, and says so', () => {
    toast.value = null;
    renameMember(memberId('sby01'), 'prm01');
    expect(doc.value.topology.members.map((m) => m.id as string)).toEqual(['prm01', 'sby01']);
    expect((toast.value as { text: string } | null)?.text).toContain(WHY.nameTaken);
  });

  it('moves the primary role rather than allowing two', () => {
    setPrimary(memberId('sby01'));
    const roles = doc.value.topology.members
      .filter((m) => m.kind === 'database')
      .map((m) => (m as DatabaseMember).role);
    expect(roles.filter((r) => r === 'primary')).toHaveLength(1);
    expect(member('sby01').role).toBe('primary');
    expect(member('prm01').role).toBe('physical');
  });
});

describe('the issue panel', () => {
  it('renders what validate() found, with its basis beside it', async () => {
    /* Information is folded by default; this is the panel with the fold open. */
    notesOpen.value = true;
    const root = mount(IssuePanel);
    await tick();
    const found = validate(doc.value.topology);
    expect(found.length).toBeGreaterThan(0);
    const rows = root.querySelectorAll('.issue');
    expect(rows.length).toBeGreaterThanOrEqual(found.length);
    /* Severity and basis are orthogonal: both are on the row. */
    expect(root.querySelector('.issue .tag')).not.toBeNull();
    expect(root.textContent).toContain('MODEL.OBSERVER_OVERRIDE');
  });

  it('selects what a finding is about', async () => {
    notesOpen.value = true;
    const root = mount(IssuePanel);
    await tick();
    /* The row whose *subject* is a member, not merely one whose sentence
       mentions it: a configuration-wide finding selects nothing. */
    const row = [...root.querySelectorAll<HTMLButtonElement>('button.issue')]
      .find((b) => (b.querySelector('.issue-id')?.textContent ?? '').includes('sby01'));
    row?.click();
    await tick();
    expect(selection.value.length).toBeGreaterThan(0);
  });

  it('folds information behind a toggle, and never colours it as a warning', async () => {
    const root = mount(IssuePanel);
    await tick();
    const notes = validate(doc.value.topology).filter((f) => f.severity === 'info');
    expect(notes.length).toBeGreaterThan(0);

    /* Folded: the rows are absent from the document, not painted out of view. */
    expect(root.querySelectorAll('.issue.sv-info').length).toBe(0);
    const tog = root.querySelector<HTMLButtonElement>('.notes-tog');
    expect(tog).not.toBeNull();
    expect(tog?.textContent).toContain(`${notes.length} note`);
    expect(tog?.getAttribute('aria-expanded')).toBe('false');
    /* The header counts what is wrong, and information is not wrong: the
       tally names errors and warnings and leaves the notes to the toggle. */
    const head = root.querySelector('.issues-hd')?.textContent ?? '';
    expect(head).not.toContain('information');
    expect(head).not.toContain(`${notes.length} note`);

    tog?.click();
    await tick();
    expect(root.querySelectorAll('.issue.sv-info').length).toBe(notes.length);
    expect(root.querySelector('.notes-tog')?.getAttribute('aria-expanded')).toBe('true');
    /* Slate, never amber: an INFO row that wears the warning colour is a
       warning however its severity is spelled. */
    for (const row of root.querySelectorAll('.issue.sv-info')) {
      expect(row.querySelector('.tag')?.className).toContain('t-sl');
      expect(row.querySelector('.tag')?.className).not.toContain('t-am');
    }
  });

  it('unfolds the notes on paper -- there is no toggle to press on a printout', async () => {
    printing.value = true;
    try {
      const root = mount(IssuePanel);
      await tick();
      const notes = validate(doc.value.topology).filter((f) => f.severity === 'info');
      expect(root.querySelectorAll('.issue.sv-info').length).toBe(notes.length);
    } finally {
      printing.value = false;
    }
  });

  it('says something true when there is nothing to report', async () => {
    const empty = classicDoc();
    resetHistory({
      ...empty,
      topology: {
        ...empty.topology,
        config: { ...empty.topology.config, fsfo: { ...empty.topology.config.fsfo, state: 'disabled' } },
        observers: [],
        members: empty.topology.members.map((m) => (m.kind === 'database'
          ? { ...m, flashbackOn: true, staticServices: true }
          : m)),
      },
    });
    const root = mount(IssuePanel);
    await tick();
    if (root.querySelector('.issue') === null) {
      expect(root.textContent).toContain('as modelled here');
    }
  });

  it('opens the fold a configuration finding lives in, at every severity', async () => {
    notesOpen.value = true;
    const root = mount(IssuePanel);
    await tick();
    /* The classic preset raises FSFO notes whose property lives in a fold that
       is shut at session start -- a row that lands the reader on a rail
       without the property it names is a button that does not go where it
       points. */
    const rows = [...root.querySelectorAll<HTMLButtonElement>('button.issue')];
    const ruleOf = (b: HTMLButtonElement): string =>
      (b.querySelector('.issue-id')?.textContent ?? '').split(' ·')[0]?.trim() ?? '';
    const row = rows.find((b) => {
      const s = sectionOfRule(ruleOf(b));
      return s !== null && s !== DEFAULT_OPEN;
    });
    expect(row).toBeDefined();
    const section = sectionOfRule(ruleOf(row as HTMLButtonElement)) as string;
    expect(isSectionOpen(section)).toBe(false);

    row?.click();
    await tick();
    expect(isSectionOpen(section)).toBe(true);
  });

  it('folds to its heading, keeps the counts on it, and unfolds for the status-bar count', async () => {
    notesOpen.value = true;
    issuesOpen.value = true;
    const root = mount(IssuePanel);
    await tick();
    const hd = root.querySelector<HTMLButtonElement>('button.issues-hd')!;
    expect(hd.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.issues-body')).not.toBeNull();
    hd.click();
    await tick();
    expect(issuesOpen.value).toBe(false);
    expect(root.querySelector('.issues-body')).toBeNull();
    expect(root.querySelector('.issue')).toBeNull();
    expect(root.querySelector('.issues')?.classList.contains('is-folded')).toBe(true);
    /* Folded, the heading still counts: the rows are hidden, their existence is not. */
    expect(root.querySelector('.issues-hd .caption')?.textContent).toMatch(/note/);
    /* Remembered, so the fold survives a reload (where there is storage to remember in). */
    const store = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (store) expect(store.getItem('dg-issues')).toBe('0');
    revealFindings();
    await tick();
    expect(issuesOpen.value).toBe(true);
    expect(root.querySelector('.issues-body')).not.toBeNull();
  });

  it('says what it does when the findings pull the reader out of a lesson', async () => {
    mode.value = 'learn';
    lessonId.value = 'fsfo-basics';
    lessonStep.value = 2;
    revealFindings();
    /* Build is where the panel is, so Build is where it goes -- but not in
       silence, and not at the cost of the reading position. */
    expect(mode.value).toBe('build');
    expect(lessonId.value).toBe('fsfo-basics');
    expect(lessonStep.value).toBe(2);
    const said = toast.peek();
    expect(said?.text).toContain('lesson');
    said?.action?.run();
    expect(mode.value).toBe('learn');
  });
});

describe('bounds', () => {
  it('takes every range from the engine table rather than carrying its own', async () => {
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    const threshold = root.querySelector<HTMLInputElement>('input[aria-label="FastStartFailoverThreshold"]');
    expect(threshold?.min).toBe(String(BOUNDS.thresholdSeconds.min));
    expect(threshold?.max).toBe(String(BOUNDS.thresholdSeconds.max));
  });
});

describe('FastStartFailoverLagLimit: the limit in force until it is set (ED-03)', () => {
  const lagField = (root: HTMLElement): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>('.field')]
      .find((el) => el.querySelector('.field-name')?.textContent === 'FastStartFailoverLagLimit');

  it('reads the edition\'s broker default while the property is not set, and an edit sets it', async () => {
    resetHistory(makeDoc(presetDoc('classic')));
    expect(doc.value.topology.config.fsfo.lagLimitSet).toBeUndefined();
    edition.value = '26ai';
    const root = mount(Inspector);
    await tick();
    await unfold(root, 'Fast-start failover');
    /* 26ai maximum availability: the broker default is 0, zero data loss. */
    const box = (): HTMLInputElement =>
      lagField(root)?.querySelector<HTMLInputElement>('input') as HTMLInputElement;
    expect(box().value).toBe('0');
    edition.value = '19c';
    await tick();
    expect(box().value).toBe('30');
    edition.value = '26ai';
    await tick();
    /* A number box commits on change (ED-12 made the limit one: 5 to 3600 is no slider). */
    box().value = '10';
    box().dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(doc.value.topology.config.fsfo.lagLimitSet).toBe(true);
    expect(doc.value.topology.config.fsfo.lagLimitSeconds).toBe(10);
    expect(box().value).toBe('10');
  });
});
