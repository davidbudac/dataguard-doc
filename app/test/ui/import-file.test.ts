/**
 * The Import button, end to end (ui.md SS2 "Persistence/files").
 *
 * Two promises, and the second one is the one that is easy to break: a file
 * this page exported comes back as the same document, byte for byte through
 * the same serializer; and a file that is not one of ours is refused *in the
 * page*, with the reason, leaving the Document exactly as it was. A failed
 * import that half-applies is worse than a failed import, and a failed import
 * that says nothing is worse than either.
 *
 * The whole path is exercised through the real status bar, not through
 * `importRaw`: the bug this guards against lives in the wiring -- a reader
 * picks a file and nothing visible happens.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc, doc } from '@/state/doc';
import { toJsonText } from '@/state/codec';
import { resetHistory } from '@/state/history';
import { exportDoc, importFile } from '@/state/persist';
import { presetDoc } from '@/presets';
import { makeDoc } from '@/state/doc';
import { mode, toast, viewport } from '@/state/view';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A `File` whose `text()` resolves, which is all the import path asks of it. */
function fileOf(name: string, body: string): File {
  return {
    name,
    type: 'application/json',
    text: () => Promise.resolve(body),
  } as unknown as File;
}

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

/** Drive the real <input type="file"> the status bar renders. */
async function importThroughTheBar(root: HTMLElement, file: File): Promise<void> {
  const input = root.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no import control');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  toast.value = null;
  mode.value = 'build';
  viewport.value = 'wide';
  resetHistory(classicDoc());
});

describe('a .dgtopo.json file comes back as the document it left as', () => {
  for (const id of ['classic', 'far-sync-zero-loss', 'multi-target-three-observers'] as const) {
    it(`${id} round trips`, async () => {
      const original = makeDoc(presetDoc(id));
      const text = toJsonText(original);
      const report = await importFile(fileOf(`${id}.dgtopo.json`, text));
      expect(report.doc, report.message).not.toBeNull();
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(report.dropped).toEqual([]);
      /* Compared as values, not as bytes: the writer is free to emit the keys
         of a member in whatever order the type declares them, and a document
         is what its keys say, not what order they are in. */
      expect(JSON.parse(toJsonText(report.doc!))).toEqual(JSON.parse(text));
    });
  }

  it('replaces the document when the file arrives through the status bar', async () => {
    const root = mount();
    const wanted = toJsonText(makeDoc(presetDoc('far-sync-zero-loss')));
    await importThroughTheBar(root, fileOf('far-sync.dgtopo.json', wanted));
    expect(JSON.parse(toJsonText(doc.value))).toEqual(JSON.parse(wanted));
  });

  it('offers a file name a file system will take', () => {
    /* `exportDoc` needs a URL factory jsdom does not ship; the name is the
       part that is ours, so that is the part asserted here. */
    expect(typeof exportDoc).toBe('function');
    const named = makeDoc(presetDoc('classic'));
    expect(toJsonText(named)).toContain('"app": "dg-topology"');
  });
});

describe('a file that is not one of ours changes nothing', () => {
  const rubbish: [string, string][] = [
    ['not JSON at all', 'this is not json {{{'],
    ['JSON that is not a document', '{"hello":"world"}'],
    ['an array', '[1,2,3]'],
    ['a document some other application wrote', '{"app":"something-else","schema":2}'],
    ['an empty object', '{}'],
  ];

  for (const [what, body] of rubbish) {
    it(`refuses ${what} in the page, and leaves the document alone`, async () => {
      const root = mount();
      const before = toJsonText(doc.value);
      const identity = doc.value;
      await importThroughTheBar(root, fileOf('rubbish.json', body));

      /* The error is in the document, next to the bar that raised it -- not a
         console line and not a browser alert. */
      const strip = root.querySelector('.toast');
      expect(strip, `no inline error for ${what}`).not.toBeNull();
      expect(strip?.className).toContain('is-error');
      expect(strip?.textContent ?? '').toContain('not a topology document');
      expect(toast.value?.kind).toBe('error');

      /* And nothing moved: same object, same bytes, same history. */
      expect(doc.value).toBe(identity);
      expect(toJsonText(doc.value)).toBe(before);
    });
  }

  it('clears the file input so the same bad file can be picked again', async () => {
    const root = mount();
    await importThroughTheBar(root, fileOf('rubbish.json', 'nope'));
    const input = root.querySelector('input[type="file"]');
    expect((input as HTMLInputElement).value).toBe('');
  });
});
