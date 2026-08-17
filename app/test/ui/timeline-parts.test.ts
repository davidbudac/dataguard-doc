/**
 * The two pieces of the timeline that are arithmetic rather than markup -- the
 * brace path (ported from the fragment) and the transport's step helpers --
 * and the one piece of its markup that is a keyboard contract: the playhead's
 * focus stop.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { bracePath } from '@/ui/timeline/Brace';
import { nextChange, prevChange } from '@/ui/timeline/Playhead';
import { SPEEDS, WHY } from '@/ui/timeline/Transport';

describe('bracePath', () => {
  it('puts the tips exactly on the interval it measures', () => {
    const d = bracePath(100, 300, 40, 1);
    expect(d.startsWith('M100,40')).toBe(true);
    /* the last horizontal run stops one curl radius short of x1, then curls */
    expect(d).toContain('H295');
  });

  it('degrades to a bracket with a stem below 22 px of span', () => {
    const d = bracePath(100, 110, 40, 1);
    expect(d).toBe('M100,40 V45 H110 V40 M105,45 V50');
    expect(d).not.toContain('q');
  });

  it('opens upwards when asked to', () => {
    expect(bracePath(100, 110, 40, -1)).toBe('M100,40 V35 H110 V40 M105,35 V30');
  });
});

describe('state stepping', () => {
  const changes = [0, 12.5, 30, 45];

  it('steps to the next change, strictly after now', () => {
    expect(nextChange(changes, -5)).toBe(0);
    expect(nextChange(changes, 0)).toBe(12.5);
    expect(nextChange(changes, 44.9)).toBe(45);
    expect(nextChange(changes, 45)).toBeNull();
  });

  it('steps to the previous change, strictly before now', () => {
    expect(prevChange(changes, 60)).toBe(45);
    expect(prevChange(changes, 30)).toBe(12.5);
    expect(prevChange(changes, 0)).toBeNull();
  });

  it('offers 1x among its speeds and a reason for every gray state', () => {
    expect(SPEEDS).toContain(1);
    for (const why of Object.values(WHY)) expect(why.length).toBeGreaterThan(0);
  });
});

/**
 * The playhead is an SVG <g role="slider">, so its focus attribute has to be
 * spelled the way SVG spells it. A camel-cased `tabIndex` on an element
 * outside the HTML namespace is a literal attribute, not the focus one, and a
 * slider that cannot take focus is a slider the keyboard cannot move.
 */
/**
 * The transport used to sit ~550 px down a timeline drawn into a 320-500 px
 * dock: it was below the fold at 1440x900 and the page read as a static
 * picture. `position: sticky; bottom: 0` fixes that only if the sticky element
 * is a flow child of the timeline and the timeline's last one, so the DOM order
 * is the contract, and it is pinned here.
 *
 * The band carries the controls and only the controls. Sharing it with the
 * colour key wrapped it to two rows at every dock width the shell uses -- 67 px
 * of a 226 px scrollport, at every scroll position -- to keep a key that is
 * read once permanently on screen.
 */
describe('the timeline foot', () => {
  const mountTimeline = async (): Promise<HTMLElement> => {
    const { h, render } = await import('preact');
    const { Timeline } = await import('@/ui/timeline/Timeline');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const doc = classicDoc().topology;
    const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: doc.hosts[0]!.id }]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(Timeline, {
        trace, doc, width: 900, tNow: 0,
        onSeek: () => undefined, onPlayToggle: () => undefined, onSpeed: () => undefined,
      }),
      host,
    );
    return host;
  };

  it('pins the controls and nothing else', async () => {
    const host = await mountTimeline();
    const foot = host.querySelector('.tl-foot');
    expect(foot).not.toBeNull();
    expect(foot!.querySelector('.tl-transport')).not.toBeNull();
    expect(foot!.children.length).toBe(1);
    expect(foot!.querySelector('.tl-legend')).toBeNull();
  });

  it('leaves the colour key in flow, above the band', async () => {
    const host = await mountTimeline();
    const tl = host.querySelector('.tl')!;
    const kids = [...tl.children];
    const legend = host.querySelector('.tl-legend')!;
    const foot = host.querySelector('.tl-foot')!;
    expect(legend.parentElement).toBe(tl);
    expect(kids.indexOf(legend)).toBeLessThan(kids.indexOf(foot));
  });

  it('draws no empty band when there is no transport to pin', async () => {
    const { h, render } = await import('preact');
    const { Timeline } = await import('@/ui/timeline/Timeline');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const doc = classicDoc().topology;
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(Timeline, { trace: simulate(doc, []), doc, width: 900, tNow: 0 }), host);
    expect(host.querySelector('.tl-foot')).toBeNull();
    expect(host.querySelector('.tl-legend')).not.toBeNull();
  });

  it('is a flow child of the timeline, so sticky has a scroll box to stick in', async () => {
    const host = await mountTimeline();
    const tl = host.querySelector('.tl')!;
    const foot = host.querySelector('.tl-foot')!;
    expect(foot.parentElement).toBe(tl);
    /* Only the screen-reader duplicate may follow it, and that is out of flow. */
    const after = [...tl.children].slice([...tl.children].indexOf(foot) + 1);
    expect(after.every((el) => el.classList.contains('sr'))).toBe(true);
  });

  /**
   * `position: sticky` pins on one axis only, so anything that gives the dock
   * a horizontal scrollbar carries the foot sideways out of the viewport with
   * it -- and a `<table class="sr">` does exactly that: a table's used width
   * can never fall below its min-content width, so the visually hidden
   * duplicate laid out ~1084 px wide inside a 903 px dock. The clip has to be
   * a block box around the table, the shape TopoCanvas already uses.
   */
  it('clips the screen-reader table with a block wrapper, not the table itself', async () => {
    const host = await mountTimeline();
    expect(host.querySelector('table.sr')).toBeNull();
    const wrap = host.querySelector('.tl > .sr')!;
    expect(wrap.tagName).toBe('DIV');
    const table = wrap.querySelector('table')!;
    /* Still a real table in the a11y tree: the role must survive the clip. */
    expect(table.classList.contains('sr')).toBe(false);
    expect(table.querySelector('caption')).not.toBeNull();
    expect(table.querySelectorAll('thead th').length).toBe(5);
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('writes no inline style', async () => {
    const host = await mountTimeline();
    for (const el of host.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });
});

/**
 * Reaching for the playhead stops the run. Playback owns the playhead while it
 * is running (playback.ts), so a seek that did not stop it would be overwritten
 * one frame later -- the drag would snap back.
 */
describe('a seek during playback takes the playhead back', () => {
  const parts = async () => {
    const { h, render } = await import('preact');
    const { Transport } = await import('@/ui/timeline/Transport');
    const { buildTimeline } = await import('@/ui/timeline/build');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const bare = classicDoc().topology;
    const events = [{ at: 0, kind: 'host.down' as const, host: bare.hosts[0]!.id }];
    /* `model.empty` reads the *document's* events, not the trace's, and an
       empty model grays every control in the transport. */
    const doc = { ...bare, events };
    const model = buildTimeline(simulate(doc, events), doc, { width: 900 });
    return { h, render, Transport, model };
  };

  it('pauses when the transport steps or rewinds while playing', async () => {
    const { h, render, Transport, model } = await parts();
    const seeks: number[] = [];
    const toggles: number[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(Transport, {
        model, tNow: 0, playing: true, speed: 1,
        onSeek: (t: number) => seeks.push(t),
        onPlayToggle: () => toggles.push(1),
        onSpeed: () => undefined,
      }),
      host,
    );
    const back = host.querySelector<HTMLButtonElement>('button[aria-label="Back to the start"]')!;
    back.click();
    expect(toggles.length).toBe(1);
    expect(seeks).toEqual([model.scale.t0]);
  });

  it('leaves the transport alone when it is not playing', async () => {
    const { h, render, Transport, model } = await parts();
    const toggles: number[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(Transport, {
        model, tNow: 0, playing: false, speed: 1,
        onSeek: () => undefined,
        onPlayToggle: () => toggles.push(1),
        onSpeed: () => undefined,
      }),
      host,
    );
    host.querySelector<HTMLButtonElement>('button[aria-label="Back to the start"]')!.click();
    expect(toggles.length).toBe(0);
  });

  it('pauses when an arrow key moves the playhead while playing', async () => {
    const { h, render } = await import('preact');
    const { Playhead } = await import('@/ui/timeline/Playhead');
    const { buildTimeline } = await import('@/ui/timeline/build');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const doc = classicDoc().topology;
    const model = buildTimeline(simulate(doc, []), doc, { width: 900 });
    const seeks: number[] = [];
    const toggles: number[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svg);
    render(
      h(Playhead, {
        model, tNow: 5, playing: true,
        onSeek: (t: number) => seeks.push(t),
        onTogglePlay: () => toggles.push(1),
      }),
      svg as unknown as HTMLElement,
    );
    const g = svg.querySelector('.tl-playhead-g')!;
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(toggles.length).toBe(1);
    expect(seeks).toEqual([6]);
  });
});

describe('the playhead is focusable', () => {
  it('carries a lower-case tabindex', async () => {
    const { h, render } = await import('preact');
    const { Playhead } = await import('@/ui/timeline/Playhead');
    const { buildTimeline } = await import('@/ui/timeline/build');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const doc = classicDoc().topology;
    const model = buildTimeline(simulate(doc, []), doc, { width: 900 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svg);
    render(h(Playhead, { model, tNow: 0, onSeek: () => undefined }), svg as unknown as HTMLElement);
    expect(svg.querySelector('[tabIndex]')).toBeNull();
    expect(svg.querySelector('[tabindex]')).not.toBeNull();
  });
});
