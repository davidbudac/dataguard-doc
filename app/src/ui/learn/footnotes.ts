/**
 * Which footnotes a lesson actually cites.
 *
 * The five footnotes are one shared list (`content/footnotes.tsx`) and the
 * markers are `<Fn n={2} />` inside the prose. Printing all five under every
 * lesson would be noise, and printing none would leave a marker pointing at
 * nothing -- so the lesson foot carries exactly the ones its steps refer to, in
 * numeric order. The scan walks the Preact trees the content module built at
 * module load; it renders nothing and needs no DOM.
 */

import type { VNode } from 'preact';
import { Fn, FOOTNOTES } from '@/content';
import type { Footnote, Lesson } from '@/content';

const isVNode = (n: unknown): n is VNode<Record<string, unknown>> =>
  typeof n === 'object' && n !== null
  && 'type' in (n as Record<string, unknown>) && 'props' in (n as Record<string, unknown>);

/** Every footnote number marked anywhere in this tree. */
export function markersIn(root: unknown, out = new Set<number>()): Set<number> {
  if (Array.isArray(root)) { root.forEach((n) => markersIn(n, out)); return out; }
  if (!isVNode(root)) return out;
  const props = (root.props ?? {}) as Record<string, unknown>;
  if (root.type === Fn && typeof props['n'] === 'number') out.add(props['n']);
  for (const value of Object.values(props)) {
    if (Array.isArray(value) || isVNode(value)) markersIn(value, out);
  }
  return out;
}

/** The footnotes this lesson's steps cite, in numeric order. */
export function footnotesFor(lesson: Lesson): Footnote[] {
  const used = new Set<number>();
  for (const step of lesson.steps) markersIn(step.prose, used);
  return FOOTNOTES.filter((f) => used.has(f.n));
}
