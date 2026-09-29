/* PROTOTYPE — Break layout variants (throwaway; shared by the prototype branches). */

import { useEffect } from 'preact/hooks';
import { cycleProtoVariant, PROTO_LABEL, protoVariant } from './proto-variant';
import '@/styles/proto-switcher.css';

/** Typing, and sliders/menus that use the arrow keys themselves, keep them. */
function keyBelongsToPage(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return true;
  const el = e.target;
  if (!(el instanceof Element)) return false;
  if (el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return true;
  return el.closest('[role="slider"],[role="tab"],[role="menu"],[role="listbox"]') !== null;
}

export function ProtoSwitcher() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (keyBelongsToPage(e)) return;
      cycleProtoVariant(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const v = protoVariant.value;
  return (
    <div class="proto-sw" role="group" aria-label="Prototype layout variant">
      <button type="button" class="proto-sw-b" aria-label="Previous variant" onClick={() => cycleProtoVariant(-1)}>‹</button>
      <span class="proto-sw-l">{PROTO_LABEL[v]}</span>
      <button type="button" class="proto-sw-b" aria-label="Next variant" onClick={() => cycleProtoVariant(1)}>›</button>
    </div>
  );
}
