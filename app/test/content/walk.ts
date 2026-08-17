/**
 * A tiny VNode walker for the content tests.
 *
 * The lessons are Preact trees built at module load, so the tests can inspect
 * them without a DOM: `h()` returns a plain object whose children are in
 * `props.children`. Nothing here renders -- rendering would need a component
 * runtime and would say less about the content than reading it does.
 */

import type { VNode } from 'preact';

type Node = unknown;

const isVNode = (n: Node): n is VNode<Record<string, unknown>> =>
  typeof n === 'object' && n !== null && 'type' in (n as Record<string, unknown>)
  && 'props' in (n as Record<string, unknown>);

/** Every vnode in the tree, depth first, including the root. */
export function vnodes(root: Node): VNode<Record<string, unknown>>[] {
  const out: VNode<Record<string, unknown>>[] = [];
  const visit = (n: Node): void => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!isVNode(n)) return;
    out.push(n);
    const props = (n.props ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (Array.isArray(v) || isVNode(v)) visit(v);
      /* `data` on <RefTable>, `caption` on <Figure>: values that carry vnodes. */
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && !isVNode(v)) {
        for (const inner of Object.values(v as Record<string, unknown>)) visit(inner);
      }
    }
  };
  visit(root);
  return out;
}

/** All human-readable text in the tree: children, titles, labels, captions. */
export function text(root: Node): string {
  const parts: string[] = [];
  const push = (s: unknown): void => {
    if (typeof s === 'string') parts.push(s);
    else if (typeof s === 'number') parts.push(String(s));
  };
  const visit = (n: Node): void => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n === 'string' || typeof n === 'number') { push(n); return; }
    if (!isVNode(n)) {
      if (typeof n === 'object' && n !== null) {
        for (const inner of Object.values(n as Record<string, unknown>)) visit(inner);
      }
      return;
    }
    const props = (n.props ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (key === 'aria-label' || key === 'title' || key === 'label' || key === 'note') {
        push(v);
        continue;
      }
      /* Attribute strings (class, href, d, x) are not prose. */
      if (typeof v === 'string' || typeof v === 'number') {
        if (key === 'children') push(v);
        continue;
      }
      visit(v);
    }
  };
  visit(root);
  return parts.join(' ');
}
