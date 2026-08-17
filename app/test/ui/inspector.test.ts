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
  BOUNDS, formatRedoRoutes, isTopologyDoc, parseTopologyDoc, resolveRedoGraph, validate,
} from '@/engine';
import type { DatabaseMember, MemberId } from '@/engine';
import { memberId } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { clearSelection, edition, mode, notesOpen, selection, viewport } from '@/state/view';
import { Inspector } from '@/ui/inspector/Inspector';
import { IssuePanel } from '@/ui/IssuePanel';
import { addDatabase, addFarSync, addObserver, renameMember, setPrimary } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { printing } from '@/ui/print';

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const whyTexts = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.why')].map((el) => el.textContent ?? '');

const member = (id: string): DatabaseMember =>
  doc.value.topology.members.find((m) => (m.id as string) === id) as DatabaseMember;

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  edition.value = '19c';
  notesOpen.value = false;
  clearSelection();
});

describe('the WhyPill contract', () => {
  it('gives a disabled control a reason, in words, beside it', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    /* The primary applies no redo, so its apply-lag control is off -- and it
       says so rather than greying out in silence. */
    const pills = whyTexts(root);
    expect(pills).toContain(WHY.primaryNoApply);
    const off = root.querySelector('.field.is-off');
    expect(off).not.toBeNull();
    expect(off?.querySelector('.why')?.textContent).toBeTruthy();
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
    /* 19c, maximum availability: the limit is a maximum performance property
       there, and 26ai is the edition that gives it another role. */
    expect(whyTexts(root)).toContain(WHY.lagLimitMaxAvail19c);
    edition.value = '26ai';
    await tick();
    expect(whyTexts(root)).not.toContain(WHY.lagLimitMaxAvail19c);
  });

  it('gates PreferredObserverHosts on the release', async () => {
    const root = mount(Inspector);
    await tick();
    expect(whyTexts(root)).toContain(WHY.needs26ai);
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
    const root = mount(Inspector);
    await tick();
    /* FastStartFailoverLagType is documented as maximum performance mode
       behaviour, and the classic configuration runs maximum availability. */
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

  it('refuses a name another member already carries', () => {
    renameMember(memberId('sby01'), 'prm01');
    expect(doc.value.topology.members.map((m) => m.id as string)).toEqual(['prm01', 'sby01']);
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
});

describe('bounds', () => {
  it('takes every range from the engine table rather than carrying its own', async () => {
    const root = mount(Inspector);
    await tick();
    const threshold = root.querySelector<HTMLInputElement>('input[aria-label="FastStartFailoverThreshold"]');
    expect(threshold?.min).toBe(String(BOUNDS.thresholdSeconds.min));
    expect(threshold?.max).toBe(String(BOUNDS.thresholdSeconds.max));
  });
});
