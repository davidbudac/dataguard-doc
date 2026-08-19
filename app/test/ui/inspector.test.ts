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
import { hostId, memberId, siteId } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { errors } from '@/state/derived';
import {
  clearSelection, edition, hintsOn, lessonId, lessonStep, mode, notesOpen, selection, toast,
  viewport,
} from '@/state/view';
import { CanvasSlot } from '@/ui/canvas/CanvasSlot';
import { addOpen, Inspector } from '@/ui/inspector/Inspector';
import { IssuePanel, revealFindings } from '@/ui/IssuePanel';
import {
  addDatabase, addFarSync, addLink, addObserver, addSite, removeSite, renameMember, setPrimary,
} from '@/ui/inspector/edits';
import {
  ADD_ACTIONS, AddToolbar, WHY_NO_SITE, WHY_ONE_SITE, WHY_SAME_SITE,
} from '@/ui/inspector/adds';
import {
  DEFAULT_OPEN, isSectionOpen, openSections, resetSections, SECTION_IDS, sectionOfRule, SUMMARY_ID,
} from '@/ui/inspector/sections';
import { WHY } from '@/ui/inspector/why';
import { printing } from '@/ui/print';

const mount = (component: () => unknown): HTMLElement => {
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
  addOpen.value = false;
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
    await unfold(root, 'Fast-start failover');
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
    await unfold(root, 'PreferredObserverHosts');
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
    await unfold(root, 'Fast-start failover');
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
    /* The summary is a fold of its own now, above the five, and it starts
       shut: the rail opens on the palette, not on a table of what is drawn. */
    expect(togs.map((b) => b.querySelector('.eyebrow')?.textContent))
      .toEqual([SUMMARY_ID, ...SECTION_IDS]);
    expect(togs.map((b) => b.getAttribute('aria-expanded')))
      .toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
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
        .toEqual([SUMMARY_ID, ...SECTION_IDS].map(() => 'true'));
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

describe('the three ways to add something', () => {
  const RAIL = ADD_ACTIONS.map((a) => a.label);

  it('opens the empty rail on the palette, above the folded summary', async () => {
    /* `Start here` -- three numbered sentences repeating the guidance line --
       is gone, and the summary table is behind a fold: what a reader arrives
       to do is the first thing the rail offers (ui.md SS3f). */
    const root = mount(Inspector);
    await tick();
    const eyebrows = [...root.querySelectorAll('.eyebrow')].map((el) => el.textContent);
    expect(eyebrows.slice(0, 2)).toEqual(['Add', SUMMARY_ID]);
    expect(eyebrows).not.toContain('Start here');
    expect(root.querySelector('.sum')).toBeNull();
  });

  it('opens that summary when the reader asks for the explanations', async () => {
    const root = mount(Inspector);
    await tick();
    expect(root.querySelector('.sum')).toBeNull();
    hintsOn.value = true;
    await tick();
    expect(root.querySelector('.sum')).not.toBeNull();
    /* Still a real toggle: hints opened it, they do not hold it open. */
    await unfold(root, SUMMARY_ID);
    expect(root.querySelector('.sum')).toBeNull();
    hintsOn.value = false;
  });

  it('offers the same four labels in the rail and on the drawing', async () => {
    const rail = mount(Inspector);
    await tick();
    expect(buttonLabels(rail, '.pal .btn')).toEqual([...RAIL, '+ Host', '+ Link']);
    const stage = mountWith(AddToolbar, { doc: doc.value.topology });
    await tick();
    expect(buttonLabels(stage, '.cv-add .btn')).toEqual(ADD_ACTIONS.map((a) => a.short));
    /* Every toolbar button says what it will do, and none of them is mute. */
    for (const b of stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.disabled).toBe(false);
    }
    expect(stage.querySelector('.cv-add')?.getAttribute('role')).toBe('toolbar');
  });

  it('refuses in the same words on both surfaces when there is no data centre', async () => {
    const base = classicDoc();
    const bare = { ...base.topology, sites: [], hosts: [], links: [], members: [], observers: [] };
    resetHistory({ ...base, topology: bare, layout: {} });

    const stage = mountWith(AddToolbar, { doc: bare });
    await tick();
    const offOnStage = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')]
      .filter((b) => b.disabled);
    expect(offOnStage).toHaveLength(3);
    for (const b of offOnStage) {
      expect(b.parentElement?.querySelector('.why')?.textContent).toBe(WHY_NO_SITE);
    }
    /* A data centre is the one addition that never needs one. */
    expect(buttonLabels(stage, '.cv-add .btn:not(:disabled)')).toEqual(['+ Data centre']);

    const rail = mount(Inspector);
    await tick();
    const reasons = new Map(
      [...rail.querySelectorAll<HTMLButtonElement>('.pal .btn')]
        .filter((b) => b.disabled)
        .map((b) => [b.textContent ?? '', b.parentElement?.querySelector('.why')?.textContent ?? '']),
    );
    /* The three above, plus `+ Host` with nowhere to put one; `+ Link` refuses
       for its own reason, which it keeps. */
    expect([...reasons.keys()].sort())
      .toEqual(['+ Far sync instance', '+ Host', '+ Link', '+ Observer', '+ Standby database']);
    expect(reasons.get('+ Standby database')).toBe(WHY_NO_SITE);
    expect(reasons.get('+ Host')).toBe(WHY_NO_SITE);
    /* Not WHY_SAME_SITE, which was what it used to say here: nobody picked the
       same data centre twice. With none at all it is the same sentence the
       other four give -- WHY_ONE_SITE would imply there is a first. */
    expect(reasons.get('+ Link')).toBe(WHY_NO_SITE);
  });

  it('refuses `+ Link` on a one-data-centre document rather than writing a blank end', async () => {
    const base = classicDoc();
    const one = {
      ...base.topology,
      sites: base.topology.sites.slice(0, 1),
      hosts: [], links: [], members: [], observers: [],
    };
    resetHistory({ ...base, topology: one, layout: {} });

    const rail = mount(Inspector);
    await tick();
    const link = [...rail.querySelectorAll<HTMLButtonElement>('.pal .btn')]
      .find((b) => b.textContent === '+ Link');
    expect(link?.disabled).toBe(true);
    expect(link?.parentElement?.querySelector('.why')?.textContent).toBe(WHY_ONE_SITE);
    /* The picker still has nothing to point at -- there genuinely is no second
       data centre -- but the blank is now accounted for by the sentence under
       the button beside it, rather than sitting next to a live control. */
    const to = rail.querySelector<HTMLSelectElement>('select[aria-label="to"]');
    expect(to?.value).toBe('');

    link?.click();
    await tick();
    expect(doc.value.topology.links).toEqual([]);
  });

  it('keeps the data centre the reader picked, and says why it will not link it to itself', async () => {
    const rail = mount(Inspector);
    await tick();
    const to = () => rail.querySelector<HTMLSelectElement>('select[aria-label="to"]');
    const link = () => [...rail.querySelectorAll<HTMLButtonElement>('.pal .btn')]
      .find((b) => b.textContent === '+ Link');
    expect(to()?.value).toBe('dc2');

    /* Naming `from` on both sides is a thing the reader may do, and a select
       that quietly shows something else instead is worse than a refusal: the
       pick stands, and the button beside it states the rule. */
    const sel = to() as HTMLSelectElement;
    sel.value = 'dc1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(to()?.value).toBe('dc1');
    expect(link()?.disabled).toBe(true);
    expect(link()?.parentElement?.querySelector('.why')?.textContent).toBe(WHY_SAME_SITE);

    const before = doc.value.topology.links.length;
    link()?.click();
    await tick();
    expect(doc.value.topology.links).toHaveLength(before);
  });

  it('follows the document when a data centre a picker named is removed', async () => {
    const rail = mount(Inspector);
    await tick();
    const to = () => rail.querySelector<HTMLSelectElement>('select[aria-label="to"]');
    expect(to()?.value).toBe('dc2');

    /* dc2 goes from underneath the open palette. The picker must not be left
       naming it: a select whose value is not among its options renders blank,
       and `+ Link` beside it would re-create a link to a site that is gone. */
    removeSite(siteId('dc2'));
    clearSelection();
    await tick();
    const opts = [...(to()?.options ?? [])].map((o) => o.value);
    expect(opts).not.toContain('dc2');
    expect(opts).toContain(to()?.value as string);

    const link = [...rail.querySelectorAll<HTMLButtonElement>('.pal .btn')]
      .find((b) => b.textContent === '+ Link');
    link?.click();
    await tick();
    for (const l of doc.value.topology.links) {
      for (const end of l.ends as [string, string]) {
        expect(doc.value.topology.sites.some((s) => (s.id as string) === end)
          || doc.value.topology.hosts.some((h) => (h.id as string) === end)).toBe(true);
      }
    }
  });

  it('gives every add control a title, on both surfaces', async () => {
    const rail = mount(Inspector);
    await tick();
    for (const b of rail.querySelectorAll<HTMLButtonElement>('.pal .btn')) {
      expect(b.getAttribute('title'), b.textContent ?? '').toBeTruthy();
    }
  });

  it('is one tab stop with arrow keys, which is what `role="toolbar"` promises', async () => {
    const stage = mountWith(AddToolbar, { doc: doc.value.topology });
    await tick();
    const btns = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')];
    const stops = () => btns.map((b) => b.getAttribute('tabindex'));
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);

    const bar = stage.querySelector<HTMLElement>('.cv-add') as HTMLElement;
    const arrow = (key: string): void => {
      bar.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    arrow('ArrowRight');
    await tick();
    expect(stops()).toEqual(['-1', '0', '-1', '-1']);
    expect(document.activeElement).toBe(btns[1]);
    arrow('End');
    await tick();
    expect(stops()).toEqual(['-1', '-1', '-1', '0']);
    arrow('ArrowRight');
    await tick();
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);
    arrow('Home');
    await tick();
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);
  });

  it('never parks the one tab stop on a button that cannot take focus', async () => {
    const base = classicDoc();
    const bare = { ...base.topology, sites: [], hosts: [], links: [], members: [], observers: [] };
    const stage = mountWith(AddToolbar, { doc: bare });
    await tick();
    const btns = [...stage.querySelectorAll<HTMLButtonElement>('.cv-add .btn')];
    /* The three that need a data centre are off; `+ Data centre` never is, so
       the strip is always reachable by Tab. */
    expect(btns.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
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

  it('keeps the way to add things reachable while a card is selected', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    /* The palette is not in the rail -- the member's properties are -- but the
       header offers it without clearing the selection first. */
    expect(root.querySelector('.pal')).toBeNull();
    const tog = [...root.querySelectorAll<HTMLButtonElement>('.insp-hd .btn')]
      .find((b) => (b.textContent ?? '').startsWith('Add'));
    expect(tog).toBeDefined();
    expect(tog?.getAttribute('aria-expanded')).toBe('false');
    /* No `aria-controls`: the palette is genuinely absent while this is shut,
       so the reference would name nothing. `Fold` does it the same way. */
    expect(tog?.hasAttribute('aria-controls')).toBe(false);

    tog?.click();
    await tick();
    const menu = root.querySelector<HTMLElement>('#insp-add');
    expect(menu).not.toBeNull();
    expect(root.querySelector('.insp-hd .btn[aria-expanded="true"]')).not.toBeNull();
    /* The same labels, because it is the same table of actions. */
    expect(buttonLabels(menu as HTMLElement, '.pal .btn')).toEqual([...RAIL, '+ Host', '+ Link']);
    expect(selection.value).toEqual(['sby01']);
  });

  it('adds from the menu and folds itself away again', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    addOpen.value = true;
    await tick();
    const before = doc.value.topology.members.length;
    const add = [...root.querySelectorAll<HTMLButtonElement>('#insp-add .pal .btn')]
      .find((b) => b.textContent === '+ Standby database');
    add?.click();
    await tick();
    expect(doc.value.topology.members).toHaveLength(before + 1);
    expect(addOpen.value).toBe(false);
    expect(root.querySelector('#insp-add')).toBeNull();
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

  it('folds the header disclosure away when the selection moves to another card', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    const tog = () => [...root.querySelectorAll<HTMLButtonElement>('.insp-hd .btn')]
      .find((b) => (b.textContent ?? '').startsWith('Add'));
    tog()?.click();
    await tick();
    expect(root.querySelector('#insp-add')).not.toBeNull();

    /* A palette opened over sby01 is not a palette opened over prm01: its own
       header names the subject it sits under. */
    selection.value = ['prm01'];
    await tick();
    expect(addOpen.value).toBe(false);
    expect(root.querySelector('#insp-add')).toBeNull();
    expect(tog()?.getAttribute('aria-expanded')).toBe('false');
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
