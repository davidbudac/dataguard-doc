/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { h, render } from 'preact';
import { CollectDialog, CollectionNotice, collectOpen } from '@/ui/import/CollectDialog';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { edition, mode } from '@/state/view';
import { sample } from '../fixtures/collector';

const tick = () => new Promise(r => setTimeout(r, 0));
let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div'); document.body.append(root);
  resetHistory(classicDoc()); edition.value = '19c'; mode.value = 'build'; collectOpen.value = true;
  render(h('div', {}, h(CollectDialog, {}), h(CollectionNotice, {})), root);
});
afterEach(() => { render(null, root); root.remove(); collectOpen.value = false; });
async function paste(text: string) {
  const input = root.querySelector('textarea')!;
  input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
}
async function click(text: string) {
  const button = [...root.querySelectorAll('button')].find(b => b.textContent === text)!;
  expect(button).toBeTruthy(); button.click(); await tick();
}
it('previews without mutation, then imports in one undoable action with persistent provenance', async () => {
  const before = doc.value;
  await paste(sample()); await click('Preview import');
  expect(doc.value).toBe(before);
  expect(root.textContent).toContain('2 members · 2 hosts');
  await click('Draw imported topology');
  expect(doc.value.topology.members.map(m => m.name)).toEqual(['P', 'S']);
  expect(root.querySelector('.collect-notice')?.textContent).toContain('review assumptions');
  expect(collectOpen.value).toBe(false);
  undo(); await tick(); expect(doc.value).toBe(before);
});
it('invalid text leaves the document and history untouched', async () => {
  const before = doc.value;
  await paste('ORA-00942: missing privilege'); await click('Preview import');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('Oracle/client error');
  expect(doc.value).toBe(before);
});
it('editing the text invalidates a successful preview', async () => {
  await paste(sample()); await click('Preview import');
  await paste('broken');
  expect(root.textContent).not.toContain('Draw imported topology');
});

async function chooseFile(text: () => Promise<string>, size = 100) {
  const input = root.querySelector<HTMLInputElement>('#collector-file')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size, text }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}
it('loads a collector file into the same preview path', async () => {
  await chooseFile(() => Promise.resolve(sample()));
  await click('Preview import');
  expect(root.textContent).toContain('2 members · 2 hosts');
});
it('does not let a slow file read overwrite newer pasted text', async () => {
  let finish!: (text: string) => void;
  await chooseFile(() => new Promise(resolve => { finish = resolve; }));
  await paste('newer paste');
  finish(sample()); await tick();
  expect(root.querySelector('textarea')!.value).toBe('newer paste');
});
it('invalidates the previous preview when a file is too large', async () => {
  await paste(sample()); await click('Preview import');
  await chooseFile(() => Promise.resolve(sample()), 2_000_001);
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('2 MB');
  expect(root.textContent).not.toContain('Draw imported topology');
});
