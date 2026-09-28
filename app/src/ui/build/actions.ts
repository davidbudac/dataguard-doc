/**
 * What Build can do to whatever is selected, as data.
 *
 * The sibling of `break/events.ts`, and for the same reason: the drawing, the
 * rail and the Delete key are three surfaces over one configuration, and a
 * label or a *refusal* written twice is a page that can say two things about
 * one restriction. Three rules hold, the way they do in the Break table:
 *
 *  - **One entry per act.** Removing `sby01` is one `BuildAction`, whether it
 *    is pressed in the rail, on the drawing's bar or with the Delete key --
 *    literally the same object, so the three cannot drift.
 *  - **An action that cannot fire says why.** Deleting the primary, deleting
 *    the last database, FASTSYNC outside maximum availability, a round trip
 *    already at the end of its range: each is grey with its reason attached,
 *    and every reason comes out of the one WHY table.
 *  - **Multi-select is the intersection.** Actions are keyed by a stable id,
 *    so selecting three cards offers exactly what all three can do.
 *
 * Nothing here draws anything. The kinds say what a surface should make of an
 * entry -- `edit` opens the rail on it, `prop` writes a property (and
 * `pressed` says which segment of a set is the current one), `remove` takes it
 * out of the configuration -- and the surface decides how that looks.
 */

import { BOUNDS, clamp, isDatabase, isRac } from '@/engine';
import type { TopologyDoc, XptMode } from '@/engine';
import { inspectorOpen, select, viewport } from '@/state/view';
import type { WhyState } from '../common/WhyPill';
import { resolveSubject } from '../inspector/Inspector';
import {
  addDatabase, addHost, addInstance, addObserver, patchLink, removeLink, removeMember, removeObserver,
  removeSite, setLogXptMode, setMasterObserver, setPrimary,
} from '../inspector/edits';
import { off, ON, WHY } from '../inspector/why';

export interface BuildAction {
  /** Stable across subjects, so a multiple selection can be intersected. */
  id: string;
  label: string;
  /** The label to use when the action is applied to several subjects at once. */
  plural: string;
  enabled: WhyState;
  run: () => void;
  kind: 'edit' | 'prop' | 'remove';
  /** For segmented properties like the transport: is this the current value? */
  pressed?: boolean;
}

/**
 * Put the rail on this subject.
 *
 * On a wide screen the rail is a column that is already there, so selecting is
 * the whole of it. Below 1280 it is a `Sheet` the reader has to open -- and an
 * `Edit` button that silently selects something behind a closed drawer is a
 * button that appears to do nothing. `IssuePanel` opens it the same way.
 */
export function openInspectorFor(key: string): void {
  select(key);
  if (viewport.value !== 'wide') inspectorOpen.value = true;
}

const editAction = (key: string): BuildAction => ({
  id: 'edit',
  label: `Edit ${key}`,
  plural: 'Edit',
  enabled: ON,
  kind: 'edit',
  run: () => openInspectorFor(key),
});

const XPT_MODES: readonly XptMode[] = ['SYNC', 'FASTSYNC', 'ASYNC'];

/** Every action the one selected object offers. */
export function buildActionsForKey(doc: TopologyDoc, key: string): BuildAction[] {
  const subject = resolveSubject(doc, key);
  if (subject === null) return [];
  const out: BuildAction[] = [editAction(key)];

  if (subject.kind === 'member') {
    const { member } = subject;
    const db = isDatabase(member) ? member : null;
    const isPrimary = db !== null && db.role === 'primary';
    const lastDatabase = doc.members.filter(isDatabase).length <= 1;
    for (const xpt of XPT_MODES) {
      out.push({
        id: `xpt:${xpt}`,
        label: xpt,
        plural: xpt,
        /* The one per-option restriction the transport carries, in the words
           `MemberForm`'s segmented control gives it. */
        enabled: xpt === 'FASTSYNC' && doc.config.protectionMode !== 'MAXAVAILABILITY'
          ? off(WHY.fastsyncMode)
          : ON,
        kind: 'prop',
        pressed: member.logXptMode === xpt,
        run: () => setLogXptMode(member.id, xpt),
      });
    }
    out.push({
      id: 'primary',
      label: 'Make it the primary',
      plural: 'Make it the primary',
      enabled: db === null
        ? off(WHY.farSyncNoRole)
        : (isPrimary ? off(WHY.alreadyPrimary) : ON),
      kind: 'prop',
      pressed: isPrimary,
      run: () => setPrimary(member.id),
    });
    /* One more instance is what makes a database RAC: a node of its own in
       the same data centre, in the member's cluster. */
    if (db !== null) {
      out.push({
        id: 'instance:add',
        label: isRac(db) ? `+ Instance (RAC, ${db.instances.length})` : '+ Instance (make it RAC)',
        plural: '+ Instance',
        enabled: ON,
        kind: 'prop',
        run: () => addInstance(member.id),
      });
    }
    out.push({
      id: 'remove',
      label: `Remove ${key}`,
      plural: 'Remove',
      enabled: isPrimary
        ? off(WHY.primaryMember)
        : (lastDatabase && db !== null ? off(WHY.lastMember) : ON),
      kind: 'remove',
      run: () => removeMember(member.id),
    });
  }

  if (subject.kind === 'observer') {
    const { observer } = subject;
    out.push({
      id: 'master',
      label: 'Make it the master',
      plural: 'Make it the master',
      enabled: observer.role === 'master' ? off(WHY.alreadyMaster) : ON,
      kind: 'prop',
      pressed: observer.role === 'master',
      run: () => setMasterObserver(observer.id),
    });
    out.push({
      id: 'remove',
      label: `Remove ${key}`,
      plural: 'Remove',
      enabled: ON,
      kind: 'remove',
      run: () => removeObserver(observer.id),
    });
  }

  if (subject.kind === 'link') {
    const { link } = subject;
    const b = BOUNDS.latencyMs;
    /* The step is the engine's, not this table's: the slider in `LinkForm`,
       the serializer and these two buttons move the round trip by the same
       amount, and the undo entry and its coalescing key are the slider's too,
       so a drag and a run of presses are one gesture either way. */
    const setRtt = (v: number): void => patchLink(
      link.id, `Set the round trip on ${key} to ${v} ms`,
      (l) => ({ ...l, rttMs: v }), `rtt:${key}`,
    );
    out.push({
      id: 'rtt:-',
      label: `Round trip −${b.step} ms`,
      plural: `Round trip −${b.step} ms`,
      enabled: link.rttMs <= b.min ? off(WHY.rttAtFloor) : ON,
      kind: 'prop',
      run: () => setRtt(clamp('latencyMs', link.rttMs - b.step)),
    });
    out.push({
      id: 'rtt:+',
      label: `Round trip +${b.step} ms`,
      plural: `Round trip +${b.step} ms`,
      enabled: link.rttMs >= b.max ? off(WHY.rttAtCeiling) : ON,
      kind: 'prop',
      run: () => setRtt(clamp('latencyMs', link.rttMs + b.step)),
    });
    out.push({
      id: 'up',
      label: link.up ? 'Mark it down' : 'Mark it up',
      plural: link.up ? 'Mark it down' : 'Mark it up',
      enabled: ON,
      kind: 'prop',
      pressed: !link.up,
      /* The steady state, not an event at a moment on the clock -- which is
         what `LinkForm`'s note says and what its undo entry is worded as. */
      run: () => patchLink(
        link.id, `${link.up ? 'Cut' : 'Restore'} ${key}`, (l) => ({ ...l, up: !link.up }),
      ),
    });
    out.push({
      id: 'remove',
      label: `Remove ${key}`,
      plural: 'Remove',
      enabled: ON,
      kind: 'remove',
      run: () => removeLink(link.id),
    });
  }

  if (subject.kind === 'site') {
    const { site } = subject;
    const hosts = doc.hosts.filter((h) => h.site === site.id);
    out.push({
      id: 'add:standby',
      label: 'Add a standby here',
      plural: 'Add a standby',
      enabled: ON,
      kind: 'prop',
      run: () => { addDatabase(site.id); },
    });
    out.push({
      id: 'add:observer',
      label: 'Add an observer here',
      plural: 'Add an observer',
      enabled: ON,
      kind: 'prop',
      run: () => { addObserver(site.id); },
    });
    out.push({
      id: 'add:host',
      label: 'Add a host here',
      plural: 'Add a host',
      enabled: ON,
      kind: 'prop',
      run: () => { addHost(site.id); },
    });
    out.push({
      id: 'remove',
      label: `Remove ${key}`,
      plural: 'Remove',
      enabled: hosts.length > 0 ? off(WHY.siteHasHosts) : ON,
      kind: 'remove',
      run: () => removeSite(site.id),
    });
  }

  return out;
}

/**
 * The actions a whole selection offers: the intersection by id, exactly as
 * `actionsFor` does it for Break, with the first blocked subject's refusal
 * kept for the group.
 *
 * The runs are folded end to end rather than into one edit: each subject's own
 * labelled edit is what the undo menu already reads well ("Undo: Remove
 * sby02"), and a combined entry would have to invent a sentence for it.
 * `edit` is the exception -- opening a rail is not something to do three times
 * over, so it lands on the first of the selection, which is the one whose
 * properties the rail shows anyway.
 */
export function buildActionsFor(doc: TopologyDoc, keys: readonly string[]): BuildAction[] {
  if (keys.length === 0) return [];
  const per = keys.map((k) => buildActionsForKey(doc, k));
  const first = per[0];
  if (first === undefined) return [];
  if (per.length === 1) return first;
  const out: BuildAction[] = [];
  for (const a of first) {
    const mates = per.slice(1).map((list) => list.find((x) => x.id === a.id));
    if (mates.some((m) => m === undefined)) continue;
    const all = [a, ...(mates as BuildAction[])];
    const blocked = all.find((x) => x.enabled.state === 'off');
    out.push({
      id: a.id,
      label: `${a.plural} (${keys.length})`,
      plural: a.plural,
      enabled: blocked ? blocked.enabled : ON,
      kind: a.kind,
      /* A segment is pressed for the selection only when it is pressed for all
         of it: half a selection on SYNC is not a selection on SYNC. */
      ...(a.pressed === undefined ? {} : { pressed: all.every((x) => x.pressed === true) }),
      run: a.kind === 'edit' ? a.run : () => { for (const x of all) x.run(); },
    });
  }
  return out;
}

/**
 * The one action every subject has, pulled out for the surfaces that offer
 * nothing else: the Delete key on the drawing, and the Remove button at the
 * foot of each form in the rail. `null` where the key names nothing.
 */
export function removeAction(doc: TopologyDoc, key: string): BuildAction | null {
  return buildActionsForKey(doc, key).find((a) => a.kind === 'remove') ?? null;
}
