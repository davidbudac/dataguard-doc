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
  it('is a real anchor once the address bar has been written', () => {
    shareHref.value = '?mode=break#t=abc';
    const root = mount();
    const a = root.querySelector('a#permalink');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('?mode=break#t=abc');
  });

  it('is a reason, not a dead link, when the configuration does not fit', () => {
    shareHref.value = '?mode=break#t=abc';
    shareTooLarge.value = true;
    const root = mount();
    expect(root.querySelector('a#permalink')).toBeNull();
    expect(root.querySelector('.why')?.textContent).toContain('export');
  });

  it('says so rather than offering an empty href before the first write', () => {
    const root = mount();
    expect(root.querySelector('a#permalink')).toBeNull();
    expect(root.querySelector('.why')?.textContent).toBeTruthy();
  });
});
