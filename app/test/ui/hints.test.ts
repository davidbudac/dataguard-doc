/**
 * The hints: the sentence under every control, and the one switch that brings
 * it back.
 *
 * The verdict this answers was "prune the visible text a lot more -- it should
 * still be there optionally visible". So what is pinned here is both halves of
 * that: the prose is **absent from the document** by default rather than
 * painted out of view (ui.md SS8, nothing hidden by CSS alone), the `Hints`
 * button puts every word of it back, and the three kinds of line that are not
 * hints -- a caution, an empty state, a refusal -- never left in the first
 * place. Print is the fourth reading: on paper the explanations render whatever
 * the reader chose on screen, exactly as every `Fold` opens.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { HINTS_KEY, loadHints, setHints } from '@/state/persist';
import {
  clearSelection, hintsOn, mode, selection, splitGuide, viewport,
} from '@/state/view';
import { Guidance } from '@/ui/Guidance';
import { HINTS_TITLE, HintsToggle } from '@/ui/hints';
import { Inspector } from '@/ui/inspector/Inspector';
import { BreakRail } from '@/ui/break/BreakRail';
import { resetSections } from '@/ui/inspector/sections';
import { printing } from '@/ui/print';
import { WHY } from '@/ui/inspector/why';

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

const mounted: HTMLElement[] = [];

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  mounted.push(root);
  return root;
};

const unmountAll = (): void => {
  while (mounted.length > 0) render(null, mounted.pop() as HTMLElement);
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The switch, found the way a reader finds it: by its label. */
const toggle = (root: HTMLElement): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Hints');

/** One sentence out of each family of hints, so a rewording is caught. */
const RENAME_HINT = 'Renaming it rewrites every reference';
const ROLE_HINT = 'A configuration has exactly one primary';
const SUMMARY_HINT = 'Select a card, a site or a line on the drawing to edit it.';

beforeEach(() => {
  unmountAll();
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  resetSections();
  clearSelection();
  viewport.value = 'wide';
  mode.value = 'build';
  printing.value = false;
  loadHints();
});

describe('the default reading', () => {
  it('is off, and the explanation under a control is not in the document', async () => {
    expect(hintsOn.value).toBe(false);
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    expect(root.textContent).not.toContain(RENAME_HINT);
    expect(root.textContent).not.toContain(ROLE_HINT);
    /* Not a CSS trick: there is no note element left to hide. What remains
       is the handful marked `always` -- an empty state, a caution -- and none
       of them is one of the sentences above. */
    const notes = [...root.querySelectorAll('.field-note')].map((el) => el.textContent ?? '');
    expect(notes.some((t) => t.includes(RENAME_HINT))).toBe(false);
    expect(notes.some((t) => t.includes('What DGMGRL and the observer dial'))).toBe(false);
    /* The control the first sentence explained is still there, and still
       says what it is: the prose went, the property did not. */
    expect([...root.querySelectorAll('.field-name')].map((el) => el.textContent))
      .toContain('db_unique_name');
  });

  it('leaves the empty rail its summary one press away, and drops the sentence', async () => {
    /* The summary is a fold now (ui.md SS3f). What is folded is absent from
       the document rather than painted out of view, and the toggle that
       brings it back is the row the reader is looking at -- so the fact the
       table carries is still on the rail, and the sentence that explains the
       drawing is not. */
    const root = mount(Inspector);
    await tick();
    const tog = [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')]
      .find((b) => b.querySelector('.eyebrow')?.textContent === 'Configuration summary');
    expect(tog).toBeDefined();
    expect(root.querySelector('.sum')).toBeNull();
    tog!.click();
    await tick();
    expect(root.querySelector('.sum')).not.toBeNull();
    expect(root.textContent).not.toContain(SUMMARY_HINT);
  });
});

describe('the toggle', () => {
  it('puts every sentence back, and takes them away again', async () => {
    selection.value = ['prm01'];
    const root = mount(Inspector);
    await tick();
    const tog = toggle(root);
    expect(tog).toBeDefined();
    expect(tog?.getAttribute('aria-pressed')).toBe('false');
    /* With the prose gone, the button is the only thing that says it exists. */
    expect(tog?.getAttribute('title')).toBe(HINTS_TITLE);
    expect(HINTS_TITLE).toBe('Show the explanation under each control');

    tog?.click();
    await tick();
    expect(hintsOn.value).toBe(true);
    expect(toggle(root)?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain(RENAME_HINT);
    expect(root.textContent).toContain(ROLE_HINT);

    toggle(root)?.click();
    await tick();
    expect(hintsOn.value).toBe(false);
    expect(root.textContent).not.toContain(RENAME_HINT);
  });

  it('is on the empty rail too, which is where a reader looks for it', async () => {
    const root = mount(Inspector);
    await tick();
    expect(toggle(root)).toBeDefined();
    toggle(root)?.click();
    await tick();
    /* Asking for the explanations opens the summary they belong to. */
    expect(root.querySelector('.sum')).not.toBeNull();
    expect(root.textContent).toContain(SUMMARY_HINT);
  });

  it('is on the Break rail header too', async () => {
    const { BreakRail } = await import('@/ui/break/BreakRail');
    const root = mount(BreakRail);
    await tick();
    expect(root.querySelector('.hint-tog')).not.toBeNull();
  });

  it('writes no inline style, anywhere it appears', async () => {
    const root = mount(HintsToggle);
    await tick();
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });

  it('is remembered, and a reload reads it back', async () => {
    const root = mount(Inspector);
    await tick();
    toggle(root)?.click();
    await tick();
    expect(memory.get(HINTS_KEY)).toBe('1');

    /* A reload is `loadHints()` reading the key again from a clean signal. */
    hintsOn.value = false;
    loadHints();
    expect(hintsOn.value).toBe(true);

    setHints(false);
    expect(memory.get(HINTS_KEY)).toBe('0');
    hintsOn.value = true;
    loadHints();
    expect(hintsOn.value).toBe(false);
  });
});

describe('what is not a hint', () => {
  it('keeps a caution on screen with hints off', async () => {
    /* A lag limit over the threshold is state the reader is looking at, not
       documentation of the property. */
    const t = doc.value.topology;
    resetHistory({
      ...doc.value,
      topology: {
        ...t,
        config: {
          ...t.config,
          fsfo: { ...t.config.fsfo, thresholdSeconds: 20, lagLimitSeconds: 60 },
        },
      },
    });
    const root = mount(Inspector);
    await tick();
    const tog = [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')]
      .find((b) => b.querySelector('.eyebrow')?.textContent === 'Fast-start failover');
    tog?.click();
    await tick();
    expect(hintsOn.value).toBe(false);
    const warn = root.querySelector('.field-note.is-warn');
    expect(warn?.textContent).toContain('Oracle recommends the lag limit');
  });

  it('keeps the read-only warning, and every refusal, on a narrow window', async () => {
    viewport.value = 'narrow';
    const root = mount(Inspector);
    await tick();
    expect(root.querySelector('.grp-note.is-warn')?.textContent).toBe(WHY.readOnlyView);
    /* And the reader can still ask for the prose from there. */
    expect(toggle(root)).toBeDefined();
  });

  it('keeps an empty state, which reports rather than explains', async () => {
    /* A data centre with no host in it says so at every setting of the
       toggle: nothing else on the rail carries that fact. */
    const t = doc.value.topology;
    const empty = t.sites.find((s) => t.hosts.every((h) => h.site !== s.id));
    selection.value = [(empty ?? t.sites[0]!).id as string];
    const root = mount(Inspector);
    await tick();
    if (empty) expect(root.textContent).toContain('No hosts in this data centre yet.');
    /* Break's empty event list is the same contract. */
    mode.value = 'break';
    const rail = mount(BreakRail);
    await tick();
    expect(rail.textContent).toContain('Nothing has happened yet');
    expect(rail.textContent).toContain('Pick a scenario below');
  });
});

describe('the guidance line', () => {
  it('shows the gesture by default and the whole sentence with hints on', async () => {
    const root = mount(Guidance);
    const line = (): string => root.querySelector('.guide-line')?.textContent ?? '';
    const { lead, rest } = splitGuide('build', 'wide');
    expect(line()).toBe(`Build · ${lead}`);
    expect(line()).not.toContain(rest);

    setHints(true);
    await tick();
    expect(line()).toBe(`Build · ${lead} ${rest}`);
  });
});

describe('on paper', () => {
  it('renders the explanations whatever the toggle says', async () => {
    selection.value = ['prm01'];
    printing.value = true;
    const root = mount(Inspector);
    await tick();
    expect(hintsOn.value).toBe(false);
    expect(root.textContent).toContain(RENAME_HINT);
    const guide = mount(Guidance);
    await tick();
    expect(guide.querySelector('.guide-line')?.textContent)
      .toContain(splitGuide('build', 'wide').rest);
  });
});
