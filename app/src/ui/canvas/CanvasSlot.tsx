/**
 * The canvas as the shell mounts it.
 *
 * `TopoCanvas` is a pure drawing: it takes a document, a resolved redo graph
 * and (in Break mode) one frame of the trace, and it emits gestures. This
 * adapter is where those two halves meet -- it reads the derived signals and
 * turns a gesture back into a labelled edit, so one drag is one undo.
 *
 * Written by the shell workflow so `App.tsx` has something to mount; the
 * canvas workflow owns this file from here.
 */

import { memberId, observerId } from '@/engine';
import { frame, geometry, redoGraph, topology } from '@/state/derived';
import { doc, withLayout } from '@/state/doc';
import { breakCoalescing, edit } from '@/state/history';
import {
  canEdit, clearSelection, hovered, mode, select, selection, toast, viewport,
} from '@/state/view';
import { AddToolbar } from '../inspector/adds';
import { removeMember, removeObserver } from '../inspector/edits';
import { WHY } from '../inspector/why';
import { menuOpen } from './EventMenu';
import { TopoCanvas } from './TopoCanvas';

/**
 * `Delete` on a focused card, in Build mode (ui.md SS4).
 *
 * It removes exactly what the inspector's Remove button removes, refusals
 * included: a keyboard shortcut that could delete the primary -- or the last
 * database -- when the button beside it says why it cannot is two answers to
 * one question. A refusal is said out loud rather than swallowed, because a
 * key that silently does nothing is the one thing this page may not do.
 */
export function deleteFromCanvas(key: string): void {
  const t = topology.value;
  const member = t.members.find((m) => (m.id as string) === key);
  if (member) {
    const isPrimary = member.kind === 'database' && member.role === 'primary';
    const databases = t.members.filter((m) => m.kind === 'database').length;
    const why = isPrimary
      ? WHY.primaryMember
      : (member.kind === 'database' && databases <= 1 ? WHY.lastMember : null);
    if (why !== null) {
      toast.value = { kind: 'warn', text: `${key} stays: ${why}` };
      return;
    }
    removeMember(memberId(key));
    clearSelection();
    return;
  }
  if (t.observers.some((o) => (o.id as string) === key)) {
    removeObserver(observerId(key));
    clearSelection();
  }
}

export interface CanvasSlotProps {
  /** False draws a static picture: no focus stops, no pointer handlers. */
  interactive?: boolean;
}

export function CanvasSlot({ interactive = true }: CanvasSlotProps) {
  const graph = redoGraph.value;
  const geo = geometry.value;
  const editable = interactive && canEdit(viewport.value);
  /* Build's additions, in the corner of the stage: the reader looking at the
     drawing should not have to find the rail -- or clear a selection -- to add
     a standby. It is the inspector's own table of actions (inspector/adds), so
     a label and a refusal are the same on both surfaces. Absent where the page
     is read-only, and absent in Break, Configure and Learn, which do not add.
     It is drawn before the drawing so the tab order reaches it first and so
     canvas.css can give the drawing room for it without a `:has()`. */
  const toolbar = editable && mode.value === 'build'
    ? <AddToolbar doc={topology.value} />
    : null;
  if (graph === null) {
    return (
      <>
        {toolbar}
        <div class="empty">
          <span class="empty-k">Canvas</span>
          <p>
            No member carries the primary role, so there is no redo to draw. Give one
            database <span class="mono">role: primary</span> and the drawing comes back.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      {toolbar}
      <TopoCanvas
        doc={topology.value}
        graph={graph}
        {...(geo ? { geometry: geo } : {})}
        frame={mode.value === 'break' ? frame.value : null}
        overrides={doc.value.layout}
        selection={selection.value}
        hovered={hovered.value}
        interactive={editable}
        /* Why it is read-only is said once, on the stage card above (App.tsx);
           the drawing says only that it is. */
        readOnlyWhy={interactive
          ? 'This drawing is a read-only view here.'
          : 'This drawing is a live view of the configuration; the workbench beside it is where it is edited.'}
        onSelect={(key: string, additive: boolean) => select(key, additive)}
        onHover={(key: string | null) => { hovered.value = key; }}
        onClear={() => clearSelection()}
        /* Break: a click on a card, and `E` on a focused one, open the menu of
           what can be done to it. The menu has a fixed home (rail head on a wide
           screen, under the drawing otherwise), so this opens it rather than
           positioning it -- `style-src 'self'` forbids positioning anything from
           script anyway. */
        {...(editable && mode.value === 'break'
          ? { onEventMenu: (): void => { menuOpen.value = true; } }
          : {})}
        {...(editable && mode.value === 'build'
          ? { onDelete: (key: string): void => deleteFromCanvas(key) }
          : {})}
        onDrag={(key: string, offset: { dx: number; dy: number }) => {
          edit(`Move the ${key} card`, (d) => withLayout(d, key, offset), `drag:${key}`);
        }}
        onDragEnd={() => breakCoalescing()}
      />
    </>
  );
}
