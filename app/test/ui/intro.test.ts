/**
 * The Introduction (ui.md SS3e).
 *
 * What is pinned here is the contract the page makes with the rest of the
 * application: it is a page with an address, it is what a first visit opens
 * on, every button on it loads the configuration it names before it switches
 * mode, and leaving it -- by any door -- is what records that this reader has
 * been shown it.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { TopBar } from '@/ui/TopBar';
import { IntroPage } from '@/ui/intro/IntroPage';
import { introOnBoot, INTRO_HREF, jump, leaveIntro, openIntro } from '@/ui/intro/route';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { INTRO_KEY, introDismissed, loadIntro } from '@/state/persist';
import {
  applyUrlState, currentUrlState, parseUrlQuery, presetId, serializeUrlQuery, URL_DEFAULTS,
} from '@/state/url';
import {
  introOpen, introPage, lessonId, mode, panelTab, tNow, viewport,
} from '@/state/view';

/* The same in-memory Storage the header suite uses: jsdom hands back a bare
   object with no methods here, so persistence has nothing to write to. */
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, String(v)); },
    removeItem: (k: string) => { memory.delete(k); },
    clear: () => { memory.clear(); },
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  } as unknown as Storage,
});

const mounted: HTMLElement[] = [];

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  mounted.push(root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === label);
  expect(found, `no button labelled "${label}"`).toBeDefined();
  return found as HTMLButtonElement;
};

beforeEach(() => {
  while (mounted.length > 0) render(null, mounted.pop() as HTMLElement);
  document.body.innerHTML = '';
  memory.clear();
  loadIntro();
  resetHistory(classicDoc());
  presetId.value = null;
  lessonId.value = null;
  mode.value = 'build';
  panelTab.value = 'dgmgrl';
  tNow.value = 0;
  viewport.value = 'wide';
  introOpen.value = false;
  introPage.value = true;
});

/* ---------------- the address ---------------- */

describe('?intro=1', () => {
  it('parses, serializes and round trips', () => {
    expect(parseUrlQuery('?intro=1').state.intro).toBe(true);
    /* One spelling: an address that means "show the Introduction" is `1`. */
    expect(parseUrlQuery('?intro=yes').state.intro).toBe(false);
    expect(serializeUrlQuery({ ...URL_DEFAULTS, intro: true })).toBe('intro=1');
    expect(serializeUrlQuery(URL_DEFAULTS)).toBe('');
  });

  it('carries the page through the signals', () => {
    applyUrlState({ ...URL_DEFAULTS, intro: true });
    expect(introPage.value).toBe(true);
    expect(currentUrlState().intro).toBe(true);
    applyUrlState({ ...URL_DEFAULTS, intro: false });
    expect(introPage.value).toBe(false);
  });
});

describe('what boot opens', () => {
  const boot = (o: Partial<Parameters<typeof introOnBoot>[0]>): boolean => introOnBoot({
    asked: false, seen: false, hasDocument: false, keys: [], ...o,
  });

  it('opens the Introduction on a first visit', () => {
    expect(boot({})).toBe(true);
    /* A reading preference says how to render what is shown, not what to
       show: it does not count as an address of its own. */
    expect(boot({ keys: ['theme', 'ed'] })).toBe(true);
  });

  it('leaves a link to something alone', () => {
    expect(boot({ keys: ['preset'] })).toBe(false);
    expect(boot({ keys: ['lesson', 'step'] })).toBe(false);
    expect(boot({ keys: ['mode'] })).toBe(false);
    expect(boot({ hasDocument: true })).toBe(false);
  });

  it('never opens it twice on its own, and always opens it when it is asked for', () => {
    expect(boot({ seen: true })).toBe(false);
    expect(boot({ seen: true, asked: true })).toBe(true);
    expect(boot({ seen: true, asked: true, keys: ['preset'], hasDocument: true })).toBe(true);
  });
});

/* ---------------- the page in the shell ---------------- */

describe('the shell with the Introduction open', () => {
  it('renders the page in place of the stage, the rail and the dock', async () => {
    const root = mount(App);
    await tick();
    expect(root.querySelector('.ip')).not.toBeNull();
    expect(root.querySelector('.app.m-intro')).not.toBeNull();
    /* Nothing is hidden by CSS: the workbench is not in the document. */
    expect(root.querySelector('.app-rail')).toBeNull();
    expect(root.querySelector('.app-dock')).toBeNull();
    /* The header stays, and the modes with it. */
    expect(root.querySelector('.topbar')).not.toBeNull();
    expect(button(root, 'Build')).toBeDefined();
  });

  it('carries no inline style, anywhere -- style-src is \'self\'', async () => {
    const root = mount(App);
    await tick();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });

  it('draws the classic configuration, read-only', async () => {
    const root = mount(App);
    await tick();
    const svg = root.querySelector('.ip-drawing .topo-svg');
    expect(svg).not.toBeNull();
    /* A picture: nothing on it is a tab stop, and it says so in its own
       caption (`readOnlyWhy`, the same channel the narrow viewer uses). */
    expect(svg?.querySelector('[tabindex="0"]')).toBeNull();
    expect(root.querySelector('.ip-drawing')?.textContent).toContain('Read-only');
    /* And it is the classic 1+1+1, whatever the live document happens to be. */
    const text = svg?.textContent ?? '';
    for (const name of ['prm01', 'sby01', 'obs01']) expect(text).toContain(name);
  });

  it('is left by any mode button, which records that it has been shown', async () => {
    const root = mount(App);
    await tick();
    button(root, 'Configure').click();
    await tick();
    expect(introPage.value).toBe(false);
    expect(mode.value).toBe('configure');
    expect(memory.get(INTRO_KEY)).toBe('1');
    expect(introDismissed.value).toBe(true);
    expect(root.querySelector('.ip')).toBeNull();
  });

  /* The header is the same header on both pages, so every control in it has
     to keep working: the card has no guidance line to hang under here. */
  it('still opens the keyboard card from the ?', async () => {
    const root = mount(App);
    await tick();
    expect(root.querySelector('.intro-keys')).toBeNull();
    button(root, '?').click();
    await tick();
    expect(root.querySelector('.intro-keys')).not.toBeNull();
    button(root, '?').click();
    await tick();
    expect(root.querySelector('.intro-keys')).toBeNull();
  });

  it('is one link away in the header, and that link is a real one', async () => {
    introPage.value = false;
    const root = mount(TopBar);
    await tick();
    /* The brand is the link: "Data Guard", titled as the Introduction. */
    const link = [...root.querySelectorAll('a')]
      .find((a) => a.classList.contains('brand'));
    expect(link?.getAttribute('title')).toContain('Introduction');
    expect(link?.getAttribute('href')).toBe(INTRO_HREF);
    link?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(introPage.value).toBe(true);
  });
});

/* ---------------- the buttons ---------------- */

describe('the two hero buttons', () => {
  it('starts the reader on the classic configuration, in Build', async () => {
    const root = mount(IntroPage);
    await tick();
    button(root, 'Start with the classic 1+1+1').click();
    await tick();
    expect(presetId.value).toBe('classic');
    expect(mode.value).toBe('build');
    expect(introPage.value).toBe(false);
    expect(memory.get(INTRO_KEY)).toBe('1');
  });

  it('lands the failover already injected, with the playhead rested on it', async () => {
    const root = mount(IntroPage);
    await tick();
    button(root, 'Watch a failover').click();
    await tick();
    expect(presetId.value).toBe('classic');
    expect(mode.value).toBe('break');
    const events = doc.value.topology.events;
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'host.down')).toBe(true);
    /* Rested at the end of what there is to see, not at the instant before
       anything happened (`restPlayhead`). */
    expect(tNow.value).toBeGreaterThan(0);
  });
});

describe('the four "Try it" buttons', () => {
  it('draws the classic in Build', async () => {
    const root = mount(IntroPage);
    button(root, 'Draw the classic 1+1+1').click();
    await tick();
    expect(mode.value).toBe('build');
    expect(presetId.value).toBe('classic');
  });

  it('breaks a far sync configuration in Break, with the scenario applied', async () => {
    const root = mount(IntroPage);
    button(root, 'Isolate a far sync site').click();
    await tick();
    expect(mode.value).toBe('break');
    expect(presetId.value).toBe('far-sync-zero-loss');
    expect(doc.value.topology.events.length).toBeGreaterThan(0);
  });

  it('opens Configure on the DGMGRL tab', async () => {
    const root = mount(IntroPage);
    button(root, 'Print the DGMGRL commands').click();
    await tick();
    expect(mode.value).toBe('configure');
    expect(panelTab.value).toBe('dgmgrl');
  });

  it('opens the first lesson in Learn', async () => {
    const root = mount(IntroPage);
    button(root, 'Open lesson 1').click();
    await tick();
    expect(mode.value).toBe('learn');
    expect(lessonId.value).not.toBeNull();
  });
});

describe('the page itself', () => {
  it('says what the tool is, names the four modes and links the frozen page', async () => {
    const root = mount(IntroPage);
    await tick();
    const text = root.textContent ?? '';
    for (const word of ['Build', 'Break', 'Configure', 'Learn']) expect(text).toContain(word);
    expect(text).toContain('model');
    const legacy = [...root.querySelectorAll('a')]
      .find((a) => (a.getAttribute('href') ?? '').startsWith('legacy/'));
    expect(legacy).toBeDefined();
  });

  /* Five entries, and every documented claim in them carries its chip and its
     citation -- the fifth invariant holds on this page too (ui.md SS8). */
  it('labels the claims it makes about Oracle', async () => {
    const root = mount(IntroPage);
    await tick();
    expect(root.querySelectorAll('.ct-fact').length).toBeGreaterThan(0);
    for (const fact of root.querySelectorAll('.ct-fact')) {
      expect(fact.querySelector('.ct-chip')).not.toBeNull();
      expect(fact.querySelector('a')?.getAttribute('href')).toContain('oracle.com');
    }
  });

  it('is opened and left through one pair of functions', () => {
    introPage.value = false;
    introOpen.value = true;
    openIntro();
    expect(introPage.value).toBe(true);
    /* The card and the page say the same things: two of them at once is one
       too many. */
    expect(introOpen.value).toBe(false);
    leaveIntro();
    expect(introPage.value).toBe(false);
    expect(memory.get(INTRO_KEY)).toBe('1');
  });

  it('never switches mode before the document it named is loaded', () => {
    /* The order is the contract: a button that promised a failover and landed
       in Break over whatever was open would be worse than no button. */
    jump({ preset: 'max-protection', mode: 'break' });
    expect(presetId.value).toBe('max-protection');
    expect(mode.value).toBe('break');
  });
});
