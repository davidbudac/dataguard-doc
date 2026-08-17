/**
 * Configure mode: every panel renders for the classic preset, Copy hands the
 * generated text to the clipboard, and pointing at a generated line hovers the
 * member it names.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { PRESETS, classic } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { hovered, mode, panelTab, selection, toast, viewport } from '@/state/view';
import { PANEL_LABEL, PANEL_TABS } from '@/state/view';
import type { PanelTab } from '@/state/view';
import { PANEL_GROUPS, Panels, panelFromHash, panelHref, printing } from '@/ui/panels/Panels';
import { mentionIndex, subjectOf } from '@/ui/panels/CodeBlock';
import { rpDur, rpOrd, rpTickLabel } from '@/ui/panels/Reopen';
import { commitLegs } from '@/ui/panels/Commit';
import { topology } from '@/state/derived';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Panels, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Preact lowercases an `onX` prop only when `onx` is a property of the DOM
 * node. jsdom does not implement pointer events, so `onPointerEnter` is
 * registered under the capitalised name there and under `pointerenter` in a
 * browser. The test fires both rather than pretending it knows which.
 */
const pointer = (el: HTMLElement, name: 'PointerEnter' | 'PointerLeave'): void => {
  el.dispatchEvent(new Event(name.toLowerCase()));
  el.dispatchEvent(new Event(name));
};

/** The classic preset carries its own crash event; `classicDoc` is the steady state. */
const withEvents = (): void => { resetHistory(makeDoc(classic.doc())); };

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'configure';
  panelTab.value = 'dgmgrl';
  selection.value = [];
  hovered.value = null;
  toast.value = null;
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the panels render', () => {
  for (const tab of PANEL_TABS) {
    it(`renders '${tab}' for the classic preset in its steady state`, () => {
      panelTab.value = tab;
      const root = mount();
      expect(root.querySelector('.panels')).not.toBeNull();
      expect(root.querySelector('.panel')).not.toBeNull();
    });

    it(`renders '${tab}' for the classic preset with its events injected`, () => {
      withEvents();
      panelTab.value = tab;
      const root = mount();
      expect(root.querySelector('.panel')).not.toBeNull();
    });
  }

  it('carries no inline style anywhere -- style-src is \'self\'', () => {
    withEvents();
    for (const tab of PANEL_TABS) {
      document.body.innerHTML = '';
      panelTab.value = tab;
      const root = mount();
      for (const el of root.querySelectorAll('*')) {
        expect(el.getAttribute('style')).toBeNull();
      }
    }
  });

  it('renders only the open panel -- nothing is hidden by CSS', () => {
    const root = mount();
    expect(root.querySelectorAll('.panel')).toHaveLength(1);
    expect(root.querySelector('.panel')?.getAttribute('aria-label')).toBe('DGMGRL');
  });

  it('offers every panel as a real link', () => {
    const root = mount();
    const links = [...root.querySelectorAll('a.panel-tab')];
    expect(links).toHaveLength(PANEL_TABS.length);
    for (const a of links) expect(a.getAttribute('href')).toBeTruthy();
    expect(root.querySelector('a.panel-tab[aria-current="page"]')?.textContent).toContain('DGMGRL');
  });

  it('draws the application view once the run has something in it', () => {
    withEvents();
    panelTab.value = 'app';
    const root = mount();
    expect(root.querySelector('.fig-svg')).not.toBeNull();
    expect(root.querySelector('.empty')).toBeNull();
  });

  it('says why the application view is empty in the steady state', () => {
    panelTab.value = 'app';
    const root = mount();
    expect(root.querySelector('.empty')?.textContent).toContain('Nothing has happened yet');
  });

  it('draws one commit figure per direct destination', () => {
    panelTab.value = 'commit';
    const root = mount();
    const legs = commitLegs(topology.value, topology.value.members[0]?.id ?? null);
    expect(legs.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.fig-svg')).toHaveLength(legs.length);
  });
});

describe('the two groups of tabs', () => {
  it('covers every tab exactly once, in the order the row draws them', () => {
    const flat = PANEL_GROUPS.flatMap((g) => g.tabs);
    expect(flat).toEqual([...PANEL_TABS]);
    expect(new Set(flat).size).toBe(PANEL_TABS.length);
  });

  it('separates the generated files from the behaviour figures', () => {
    expect(PANEL_GROUPS.map((g) => g.label)).toEqual(['Files', 'Behaviour']);
    expect(PANEL_GROUPS[0]?.tabs).toEqual(['dgmgrl', 'dests', 'tns', 'show']);
    expect(PANEL_GROUPS[1]?.tabs).toEqual(['app', 'commit', 'reopen']);
  });

  it('labels each group in the row, before the tabs it names', () => {
    const root = mount();
    const groups = [...root.querySelectorAll('.panel-tabs .panel-group')];
    expect(groups).toHaveLength(PANEL_GROUPS.length);
    groups.forEach((g, i) => {
      const label = g.firstElementChild;
      expect(label?.className).toBe('panel-group-lbl');
      expect(label?.textContent).toBe(PANEL_GROUPS[i]?.label);
      expect([...g.querySelectorAll('a.panel-tab')]).toHaveLength(
        PANEL_GROUPS[i]?.tabs.length ?? 0,
      );
    });
  });

  it('stays one navigation, with each group named by its own label', () => {
    const root = mount();
    expect(root.querySelectorAll('nav.panel-tabs')).toHaveLength(1);
    for (const g of root.querySelectorAll('.panel-group')) {
      expect(g.getAttribute('role')).toBe('group');
      const id = g.getAttribute('aria-labelledby');
      expect(id).toBeTruthy();
      expect(root.querySelector(`#${id}`)?.textContent)
        .toBe(g.querySelector('.panel-group-lbl')?.textContent);
    }
  });

  /* The label is a heading over a row of tabs, and the only thing that can
     make it read as one is its own form -- which a rendered tree says nothing
     about. Asserted against the stylesheet, the way the print rules are. */
  describe('the label reads as a heading, not as another tab', () => {
    /* `fileURLToPath` is given the string, not a `new URL(...)`: under the
       jsdom environment `URL` is jsdom's, and Node will not take a path from
       one of those. */
    const panels = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/panels.css'),
      'utf8',
    );
    const rule = /\.panel-group-lbl\{([\s\S]*?)\}/.exec(panels)?.[1] ?? '';

    it('is set as prose: sans, sentence case, no tracking', () => {
      expect(rule).toContain('font-family:var(--sans)');
      expect(rule).toContain('font-size:11px');
      /* Case does the separating. The face alone cannot: three of the seven
         tab labels are this page's words too, and the tabs are mono
         uppercase, which is what these must not look like. */
      expect(rule).not.toContain('text-transform');
      expect(panels).not.toMatch(/\.panel-group-lbl\{[^}]*letter-spacing:\.\d/);
    });

    it('carries no opacity -- in this application a faded thing is a switched-off thing', () => {
      expect(rule).toContain('color:var(--ik3)');
      expect(rule).not.toContain('opacity');
    });

    it('names its group in sentence case in the markup too', () => {
      expect(PANEL_GROUPS.map((g) => g.label)).toEqual(['Files', 'Behaviour']);
    });
  });

  it('leaves the tabs, their addresses and the issue count where they were', () => {
    resetHistory(makeDoc(classic.doc()));
    const root = mount();
    const tabs = [...root.querySelectorAll('a.panel-tab')];
    expect(tabs.map((a) => a.textContent?.replace(/\d+$/, '')))
      .toEqual(PANEL_TABS.map((t) => PANEL_LABEL[t]));
    expect(root.querySelector('a.panel-tab[aria-current="page"]')?.textContent)
      .toContain('DGMGRL');
  });
});

describe('every preset, every panel', () => {
  it('renders without throwing, and draws no NaN into an attribute', () => {
    for (const preset of PRESETS) {
      for (const tab of PANEL_TABS) {
        document.body.innerHTML = '';
        resetHistory(makeDoc(preset.doc()));
        panelTab.value = tab;
        const html = mount().innerHTML;
        expect(html, `${preset.id} / ${tab}`).toContain('class="panel"');
        expect(html, `${preset.id} / ${tab}`).not.toContain('NaN');
      }
    }
  });

  it('says on the far sync leg that the commit ends there', () => {
    const preset = PRESETS.find((p) => p.id === 'far-sync-zero-loss');
    expect(preset).toBeDefined();
    resetHistory(makeDoc(preset!.doc()));
    panelTab.value = 'commit';
    const text = mount().textContent ?? '';
    expect(text).toContain('The commit ends here');
    expect(text).toContain('outside the transaction');
  });

  it('scopes the reopen ladder to one destination at a time', async () => {
    const preset = PRESETS.find((p) => p.id === 'multi-target-three-observers');
    resetHistory(makeDoc(preset!.doc()));
    panelTab.value = 'reopen';
    const root = mount();
    const buttons = [...root.querySelectorAll('.panel-hd .seg button')] as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(1);
    expect(root.querySelector('.panel-hd .eyebrow')?.textContent).toContain(buttons[0]?.textContent ?? '');
    buttons[1]?.click();
    await tick();
    expect(root.querySelector('.panel-hd .eyebrow')?.textContent).toContain(buttons[1]?.textContent ?? '');
  });
});

describe('print', () => {
  it('puts every panel in the document, because paper has no current tab', async () => {
    printing.value = true;
    try {
      const root = mount();
      await tick();
      expect(root.querySelectorAll('.panel')).toHaveLength(PANEL_TABS.length);
    } finally {
      printing.value = false;
    }
  });
});

describe('copy', () => {
  it('puts the generated text on the clipboard', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const root = mount();
    const btn = root.querySelector('.cb-hd button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    await tick();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain('CREATE CONFIGURATION');
  });

  it('disables the button and says why when there is no clipboard', () => {
    vi.stubGlobal('navigator', {});
    const root = mount();
    const btn = root.querySelector('.cb-hd button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(root.querySelector('.cb-hd .why')?.textContent).toContain('clipboard');
  });
});

describe('line to canvas', () => {
  it('hovers the member a line names', async () => {
    const root = mount();
    const line = root.querySelector('.cb-ln[data-member="prm01"]') as HTMLElement;
    expect(line).not.toBeNull();
    pointer(line, 'PointerEnter');
    await tick();
    expect(hovered.value).toBe('prm01');
    pointer(line, 'PointerLeave');
    await tick();
    expect(hovered.value).toBeNull();
  });

  it('marks the selected member’s lines', async () => {
    selection.value = ['sby01'];
    const root = mount();
    await tick();
    const marked = root.querySelectorAll('.cb-ln.is-sel[data-member="sby01"]');
    expect(marked.length).toBeGreaterThan(0);
  });

  it('reads a whole name only -- a host name never matches the member inside it', () => {
    const index = mentionIndex(topology.value);
    expect(subjectOf("ADDRESS=(HOST=dc1-prm01)(PORT=1521)", index)).toBe('prm01');
    expect(subjectOf("EDIT DATABASE 'sby01' SET PROPERTY LogXptMode='SYNC'", index)).toBe('sby01');
    expect(subjectOf('SHOW CONFIGURATION', index)).toBeNull();
  });
});

describe('the hash alias', () => {
  it('reads #/configure/<panel>', () => {
    expect(panelFromHash('#/configure/commit')).toBe('commit');
    expect(panelFromHash('#/configure/reopen')).toBe('reopen');
    expect(panelFromHash('#/configure/nope')).toBeNull();
    expect(panelFromHash('#t=abc')).toBeNull();
    expect(panelFromHash('')).toBeNull();
  });

  it('links to the canonical query, never to a fragment route', () => {
    for (const t of PANEL_TABS) {
      const href = panelHref(t as PanelTab);
      expect(href.startsWith('?')).toBe(true);
      expect(href).toContain('mode=configure');
      if (t !== 'dgmgrl') expect(href).toContain(`panel=${t}`);
    }
  });
});

describe('the reopen labels, ported', () => {
  it('switches the axis to minutes once the ticks are a minute apart', () => {
    expect(rpTickLabel(0, 60)).toBe('0');
    expect(rpTickLabel(120, 60)).toBe('2m');
    expect(rpTickLabel(30, 30)).toBe('30s');
  });

  it('spells durations and ordinals the way the published panel does', () => {
    expect(rpDur(45)).toBe('45 s');
    expect(rpDur(600)).toBe('10 min');
    expect(rpOrd(1)).toBe('1st');
    expect(rpOrd(2)).toBe('2nd');
    expect(rpOrd(3)).toBe('3rd');
    expect(rpOrd(4)).toBe('4th');
    expect(rpOrd(11)).toBe('11th');
    expect(rpOrd(21)).toBe('21st');
  });
});
