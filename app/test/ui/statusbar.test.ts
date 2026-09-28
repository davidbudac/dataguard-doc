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
import { GROUPED_PRESETS, PRESETS, findPreset } from '@/presets';
import { doc, classicDoc, makeDoc } from '@/state/doc';
import { edit, redo, resetHistory, undo } from '@/state/history';
import { isPristinePreset, parseUrlQuery, presetId, shareHref, shareTooLarge } from '@/state/url';
import { findingCount, presetState, share, sharedUrl } from '@/ui/StatusBar';
import { parseTopologyDoc } from '@/engine';
import { errors, issues, warnings } from '@/state/derived';
import { findingsOpen, inspectorOpen, mode, notesOpen, viewport } from '@/state/view';
import { workspacesOpen } from '@/state/workspaces';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(StatusBar, { hostRef: () => undefined }), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  presetId.value = null;
  notesOpen.value = false;
  inspectorOpen.value = false;
  shareHref.value = '';
  shareTooLarge.value = false;
  sharedUrl.value = null;
});

describe('the preset picker', () => {
  it('offers every preset the build carries, filed under a heading', () => {
    const root = mount();
    const options = [...root.querySelectorAll('#preset-picker option')];
    /* One extra option: the configuration in hand, which is not a preset. */
    expect(options.length).toBe(PRESETS.length + 1);
    expect(options[0]?.getAttribute('value')).toBe('');
    const flat = GROUPED_PRESETS.flatMap((g) => g.presets);
    expect(flat.length).toBe(PRESETS.length);
    expect(options.slice(1).map((o) => o.getAttribute('value'))).toEqual(flat.map((p) => p.id));
    /* Short in the list, the sentence on the option itself. */
    expect(options.slice(1).map((o) => o.textContent)).toEqual(flat.map((p) => p.short));
    expect(options.slice(1).map((o) => o.getAttribute('title'))).toEqual(flat.map((p) => p.title));
    const groups = [...root.querySelectorAll('#preset-picker optgroup')];
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(GROUPED_PRESETS.map((g) => g.group));
  });

  it('keeps every short title short enough to read in a dropdown', () => {
    for (const p of PRESETS) {
      expect(p.short.length, p.id).toBeLessThanOrEqual(32);
      expect(p.short.split(' ').length, p.id).toBeLessThanOrEqual(6);
    }
  });

  it('drops the word "Preset" from the bar and keeps the name for the a11y tree', () => {
    /* The picker's own first option names what is on screen, and the control
       carries a title -- a visible label repeating the control beside it is
       one more word in a bar the reader reads sideways (ui.md SS3f). The
       label element stays: a select still needs an accessible name. */
    const root = mount();
    const label = root.querySelector('label[for="preset-picker"]');
    expect(label?.textContent).toBe('Preset');
    expect(label?.className).toBe('sr');
    expect(root.querySelector('#preset-picker')?.getAttribute('title')).toBeTruthy();
  });

  it('names the preset the document is, and says so when it is no longer that', async () => {
    presetId.value = 'far-sync-zero-loss';
    const chosen = findPreset('far-sync-zero-loss');
    resetHistory(makeDoc((chosen as NonNullable<typeof chosen>).doc()));
    const root = mount();
    const select = root.querySelector('#preset-picker') as HTMLSelectElement;
    /* The document *is* that preset, so the picker shows its name -- not
       "Current configuration", which is what it used to say with ?preset= in
       the address bar. */
    expect(select.value).toBe('far-sync-zero-loss');
    expect(presetState(doc.value, 'far-sync-zero-loss').edited).toBe(false);

    edit('rename', (d) => ({ ...d, meta: { ...d.meta, name: 'mine' } }));
    await tick();
    expect(presetState(doc.value, 'far-sync-zero-loss').edited).toBe(true);
    expect(select.value).toBe('');
    expect(root.querySelector('#preset-picker option')?.textContent)
      .toBe('Current configuration (edited)');
  });

  /* The picker and the address bar answer one question -- "is this still the
     preset it names?" -- and they have to answer it with one comparator. Two
     of them, over two serializations, is how a future "a layout drag is not an
     edit" splits the label from the link with both suites still green. */
  it('asks the address bar whether the document is still the preset', () => {
    for (const p of PRESETS) {
      const fresh = makeDoc(p.doc());
      expect(presetState(fresh, p.id).edited, p.id).toBe(!isPristinePreset(fresh, p.id));
      expect(presetState(fresh, p.id).edited, p.id).toBe(false);
      const touched = { ...fresh, meta: { ...fresh.meta, name: 'mine' } };
      expect(presetState(touched, p.id).edited, p.id).toBe(!isPristinePreset(touched, p.id));
      expect(presetState(touched, p.id).edited, p.id).toBe(true);
    }
  });

  /* The lookup is the picker's own half: an id no build of this page knows is
     not an edited preset, it is no preset at all -- and `isPristinePreset`
     alone would have called it edited. */
  it('reports no preset at all for an id this build does not carry', () => {
    expect(presetState(doc.value, 'no-such-preset')).toEqual({ preset: null, edited: false });
  });

  it('does not call the reset document a preset it is not', () => {
    presetId.value = 'far-sync-zero-loss';
    const root = mount();
    const reset = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reset');
    reset?.click();
    /* Reset lands on the classic *deployment*, in its steady state -- the
       preset of that name carries the crash at t = 0 too, so claiming the id
       would make the picker say "edited" about a document nobody edited. */
    expect(presetId.value).toBeNull();
    expect(presetState(doc.value, presetId.value).edited).toBe(false);
  });

  /* Reset is undoable, so undoing it has to put the whole thing back -- the
     document *and* where it came from. Restoring only the bytes leaves a
     document that is verbatim a preset while the picker says "Current
     configuration" and the address bar swaps `?preset=` for a 1.4 kB `#t=`. */
  it('gives the preset back when a Reset is undone, and takes it away again on redo', () => {
    const chosen = findPreset('max-protection');
    resetHistory(makeDoc((chosen as NonNullable<typeof chosen>).doc()));
    presetId.value = 'max-protection';
    const root = mount();
    const reset = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reset');
    reset?.click();
    expect(presetId.value).toBeNull();

    undo();
    expect(presetId.value).toBe('max-protection');
    expect(isPristinePreset(doc.value, presetId.value)).toBe(true);
    const state = presetState(doc.value, presetId.value);
    expect(state.preset?.id).toBe('max-protection');
    expect(state.edited).toBe(false);

    redo();
    expect(presetId.value).toBeNull();
  });

  it('says only "Current configuration" when no preset named this document', () => {
    const root = mount();
    expect((root.querySelector('#preset-picker') as HTMLSelectElement).value).toBe('');
    expect(root.querySelector('#preset-picker option')?.textContent)
      .toBe('Current configuration');
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

  it('lets Undo return to an edited configuration after choosing a preset', async () => {
    edit('Personal note', (d) => ({ ...d, meta: { ...d.meta, notes: 'keep this' } }));
    const root = mount();
    const picker = root.querySelector('#preset-picker') as HTMLSelectElement;
    picker.value = 'far-sync-zero-loss';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(presetId.value).toBe('far-sync-zero-loss');
    expect(doc.value.meta.notes).toBe('');
    undo();
    expect(doc.value.meta.notes).toBe('keep this');
    expect(presetId.value).toBeNull();
  });

  it('opens Saved configurations from the overflow menu', () => {
    const root = mount();
    const item = [...root.querySelectorAll<HTMLButtonElement>('.ovf-menu button')]
      .find((b) => b.textContent === 'Saved configurations');
    expect(item).toBeDefined();
    item?.click();
    expect(workspacesOpen.value).toBe(true);
    workspacesOpen.value = false;
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

  /* It was a piece of text about a panel the reader had to go and find -- and
     in Configure and Learn about a panel that is not on the screen at all. */
  it('is a button, so a keyboard reaches it', () => {
    const root = mount();
    const count = root.querySelector('.count');
    expect(count?.tagName).toBe('BUTTON');
    expect(count?.getAttribute('type')).toBe('button');
    expect(count?.getAttribute('title')).toContain('validation findings');
  });

  it('unfolds the notes when notes are all there is', () => {
    /* The classic preset is healthy: everything it raises is a note, and a
       folded note is a panel with nothing in it. */
    const chosen = findPreset('classic');
    resetHistory(makeDoc((chosen as NonNullable<typeof chosen>).doc()));
    expect(warnings.value.length + errors.value.length).toBe(0);
    expect(issues.value.length).toBeGreaterThan(0);
    const root = mount();
    expect(notesOpen.value).toBe(false);
    (root.querySelector('.count') as HTMLButtonElement).click();
    expect(notesOpen.value).toBe(true);
  });

  it('leaves the fold alone when there is something loud to read', () => {
    /* The boot document raises a warning: the panel already has a row in it,
       and unfolding six notes on top of it buries the row that matters. */
    expect(warnings.value.length + errors.value.length).toBeGreaterThan(0);
    const root = mount();
    (root.querySelector('.count') as HTMLButtonElement).click();
    expect(notesOpen.value).toBe(false);
  });

  it('hands over to Build from the modes that host no validation panel', () => {
    for (const m of ['configure', 'learn'] as const) {
      mode.value = m;
      const root = mount();
      (root.querySelector('.count') as HTMLButtonElement).click();
      expect(mode.value).toBe('build');
    }
  });

  it('opens the findings popover in Break, over the floating canvas', () => {
    mode.value = 'break';
    viewport.value = 'medium';
    findingsOpen.value = false;
    const root = mount();
    (root.querySelector('.count') as HTMLButtonElement).click();
    expect(mode.value).toBe('break');
    expect(findingsOpen.value).toBe(true);
    expect(inspectorOpen.value).toBe(false);
  });

  it('opens the drawer in Break below the floating layout, where the findings close the rail', () => {
    mode.value = 'break';
    viewport.value = 'compact';
    const root = mount();
    (root.querySelector('.count') as HTMLButtonElement).click();
    expect(mode.value).toBe('break');
    expect(inspectorOpen.value).toBe(true);
  });
});
