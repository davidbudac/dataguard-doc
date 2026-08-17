/**
 * The status bar is where a Document comes from and where it goes: the preset
 * picker, and the link that carries the whole configuration.
 *
 * Two things drifted apart while the application was being written, and these
 * are the tests that keep them together: the picker offered one preset while
 * `src/presets` carried eleven, and the only way to copy the link was a
 * clipboard call that an insecure origin and a headless browser both refuse.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { StatusBar } from '@/ui/StatusBar';
import { PRESETS, findPreset } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { parseUrlQuery, shareHref, shareTooLarge } from '@/state/url';
import { findingCount, share, sharedUrl } from '@/ui/StatusBar';
import { parseTopologyDoc } from '@/engine';
import { viewport } from '@/state/view';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(StatusBar, { hostRef: () => undefined }), root);
  return root;
};

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  shareHref.value = '';
  shareTooLarge.value = false;
  sharedUrl.value = null;
});

describe('the preset picker', () => {
  it('offers every preset the build carries, by its own title', () => {
    const root = mount();
    const options = [...root.querySelectorAll('#preset-picker option')];
    /* One extra option: the configuration in hand, which is not a preset. */
    expect(options.length).toBe(PRESETS.length + 1);
    expect(options[0]?.getAttribute('value')).toBe('');
    expect(options.slice(1).map((o) => o.getAttribute('value'))).toEqual(PRESETS.map((p) => p.id));
    expect(options.slice(1).map((o) => o.textContent)).toEqual(PRESETS.map((p) => p.title));
  });

  it('every preset id survives the address bar, so ?preset= can name it', () => {
    for (const p of PRESETS) {
      expect(parseUrlQuery(`?preset=${p.id}`).state.preset).toBe(p.id);
    }
  });

  it('loads the document the id names, events and all', () => {
    const chosen = findPreset('far-sync-zero-loss');
    expect(chosen).toBeDefined();
    const d = makeDoc((chosen as NonNullable<typeof chosen>).doc());
    /* What `?preset=` and the picker both build has to be a document the
       engine accepts without repair -- the boot path hands it straight on. */
    expect(parseTopologyDoc(d.topology).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(d.topology.members.some((m) => m.kind === 'farsync')).toBe(true);
    expect(d.topology.events.length).toBeGreaterThan(0);
  });
});

describe('the share link', () => {
  /* One control, not two: Share copies, and then leaves the link in the bar
     as a real anchor for a browser that refused the clipboard. */
  it('shows nothing until Share has been pressed', () => {
    const root = mount();
    expect(root.querySelector('a#permalink')).toBeNull();
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Share')).toBe(true);
  });

  it('is a real anchor once Share has produced one', async () => {
    sharedUrl.value = '?mode=break#t=abc';
    const root = mount();
    const a = root.querySelector('a#permalink');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('?mode=break#t=abc');
  });

  it('copies to the clipboard and leaves the address behind', async () => {
    const written: string[] = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } },
    });
    await share();
    expect(written.length).toBe(1);
    expect(sharedUrl.value).toBe(written[0]);
    expect(sharedUrl.value).toBeTruthy();
  });

  it('is a reason, not a dead link, when the configuration does not fit', () => {
    sharedUrl.value = '?mode=break#t=abc';
    shareTooLarge.value = true;
    const root = mount();
    expect(root.querySelector('a#permalink')).toBeNull();
    expect(root.querySelector('.why')?.textContent).toContain('export');
  });
});

describe('the finding count', () => {
  /* Six INFO rows are six notes, not six issues: the count that alarmed a
     reader about a healthy configuration is the one thing this wording fixes. */
  it('counts errors and warnings as issues and information as notes', () => {
    expect(findingCount(0, 0, 6)).toBe('0 issues · 6 notes');
    expect(findingCount(0, 0, 0)).toBe('No issues');
    expect(findingCount(1, 2, 0)).toBe('3 issues');
    expect(findingCount(1, 0, 1)).toBe('1 issue · 1 note');
  });
});
