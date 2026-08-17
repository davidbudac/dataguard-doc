/**
 * Learn mode renders, and it renders under the page's own rules.
 *
 * The three that are checked here are the ones a refactor breaks silently:
 * the collapsible keeps its prose in the document (so a printout carries it),
 * every navigation is a real link, and no element anywhere carries a style
 * attribute -- `style-src 'self'` would drop it on the floor.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { LESSONS } from '@/content';
import { LearnShell } from '@/ui/learn/LearnShell';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { lessonId, lessonStep, mode, proseOpen } from '@/state/view';
import { stepTopology } from '@/ui/learn/apply';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(LearnShell, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  mode.value = 'learn';
  lessonId.value = null;
  lessonStep.value = 0;
  proseOpen.value = false;
});

describe('learn shell', () => {
  it('lists the nine lessons as real links', () => {
    const root = mount();
    const links = [...root.querySelectorAll('.learn-ol a')];
    expect(links.length).toBe(LESSONS.length);
    links.forEach((a, i) => {
      expect(a.getAttribute('href')).toBe(`#/learn/${LESSONS[i]?.id}/0`);
    });
  });

  it('carries no inline style, anywhere', () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });

  it('renders every step of a lesson, each with its own address', () => {
    lessonId.value = 'transport-layer';
    const root = mount();
    const lesson = LESSONS.find((l) => l.id === 'transport-layer');
    expect(lesson).toBeDefined();
    const steps = [...root.querySelectorAll('.ls')];
    expect(steps.length).toBe(lesson?.steps.length);
    expect(steps[0]?.querySelector('.ls-anchor')?.getAttribute('href'))
      .toBe('#/learn/transport-layer/0');
  });

  it('marks the step the workbench is set up for', async () => {
    lessonId.value = 'failover-clocks';
    lessonStep.value = 0;
    const root = mount();
    expect(root.querySelectorAll('.ls.is-active').length).toBe(1);
    lessonStep.value = 2;
    await tick();
    const active = root.querySelector('.ls.is-active');
    expect(active?.id).toBe('step-failover-clocks-2');
    expect(active?.getAttribute('aria-current')).toBe('step');
  });

  it('"Show me" puts the workbench into the state the step describes', async () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    const step = [...root.querySelectorAll('.ls')][0] as HTMLElement;
    const button = [...step.querySelectorAll('button')]
      .find((b) => b.textContent === 'Show me');
    expect(button).toBeDefined();
    button?.click();
    await tick();
    const lesson = LESSONS.find((l) => l.id === 'failover-clocks');
    expect(lesson).toBeDefined();
    if (!lesson) return;
    expect(doc.value.topology).toEqual(stepTopology(lesson, 0));
    expect(lessonStep.value).toBe(0);
  });

  it('"Open in Break" leaves Learn for the timeline', async () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    const step = [...root.querySelectorAll('.ls')][0] as HTMLElement;
    [...step.querySelectorAll('button')]
      .find((b) => b.textContent === 'Open in Break')?.click();
    await tick();
    expect(mode.value).toBe('break');
  });

  it('says why a step with nothing to set up cannot show anything', () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    /* Every disabled control in the tree carries a reason beside it. */
    for (const step of root.querySelectorAll('.ls')) {
      const disabled = [...step.querySelectorAll('button')].filter((b) => b.disabled);
      if (disabled.length === 0) continue;
      const why = step.querySelector('.why');
      expect(why?.textContent?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('keeps the Explain prose in the document while it is collapsed', async () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    const wrap = root.querySelector('.explain-wrap');
    expect(wrap).not.toBeNull();
    const button = wrap?.querySelector('button.explain') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('What this sets up');
    /* Collapsed is a class, not an unmount: print.css opens it again on paper. */
    const body = wrap?.querySelector('.explain-body');
    expect(body).not.toBeNull();
    expect(body?.textContent?.length ?? 0).toBeGreaterThan(10);
    expect(button.getAttribute('aria-controls')).toBe(body?.id);

    button.click();
    await tick();
    expect(root.querySelector('.explain-wrap')?.className).toContain('is-open');
    expect(root.querySelector('button.explain')?.textContent).toBe('Hide');
    /* The button never moves: it is where the prose it opens belongs. */
    expect(root.querySelector('.explain-wrap')?.firstElementChild?.tagName).toBe('BUTTON');
  });

  it('names the footnotes a lesson cites, and only those', () => {
    lessonId.value = 'failover-clocks';
    const root = mount();
    const numbers = [...root.querySelectorAll('.lesson-fn .ct-fn-n')].map((n) => n.textContent);
    expect(numbers).toEqual(['1', '2', '3']);

    document.body.innerHTML = '';
    lessonId.value = 'multi-observer';
    const other = mount();
    expect(other.querySelector('.lesson-fn')).toBeNull();
  });

  it('says so, in words, when a lesson id is not one of the nine', () => {
    lessonId.value = 'not-a-lesson';
    const root = mount();
    expect(root.textContent).toContain('No lesson is called');
    expect(root.querySelectorAll('.learn-ol a').length).toBe(LESSONS.length);
  });
});
