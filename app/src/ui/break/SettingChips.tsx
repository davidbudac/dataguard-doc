/**
 * The settings that are not a length on the timeline, as chips: protection
 * mode, fast-start failover and the LogXptMode of the standby the run is about,
 * with `All settings →` after them to the rest in Topology's inspector.
 *
 * The times that matter are not here: they are braces on the timeline itself
 * (ui/timeline/MiniTimeline.tsx, break/LanesView.tsx), with a grip to drag and
 * a number to type. These three are a choice from a short list, which no length
 * on an axis can say, so each is a `label value ▾` chip -- a native select drawn
 * as its value and a caret. Topology's dock carries them on the `Break` row
 * (break/PlayDock.tsx) and the Detailed timeline's bar after the readings; this
 * is the one component for both, so what a chip offers, says and refuses cannot
 * drift between them.
 *
 * Every chip is the inspector's own setting, written through the same named
 * setters (`inspector/edits.ts`) wrapped in `tuned(...)`, so its undo sentence
 * and its coalescing are the rail's and the run keeps the axis it was on. The
 * options are greyed by the same function (`logXptOptions`) with the same
 * reasons, which ride in the chip's title; the sentence each title opens with is
 * the one the inspector prints under the control (`inspector/notes.ts`).
 * Nothing new is claimed here.
 *
 * `logXpt={false}` leaves the transport chip off, for a layout that draws it
 * somewhere else.
 */

import type { ComponentChildren } from 'preact';
import type { TopologyDoc } from '@/engine';
import { topology, trace } from '@/state/derived';
import { revealRail } from '@/state/persist';
import { canEdit, clearSelection, mode, viewport } from '@/state/view';
import { isOff } from '../common/WhyPill';
import { leaveIntro } from '../intro/route';
import { setFsfoState, setLogXptMode, setProtectionMode } from '../inspector/edits';
import { fsfoStateNote, LOG_XPT_NOTE, PROTECTION_NOTE } from '../inspector/notes';
import { revealSections } from '../inspector/sections';
import { logXptOptions } from '../inspector/why';
import { tuned, tunedStandby } from '../timeline/tune';
import '@/styles/setting-chips.css';

type Mode = TopologyDoc['config']['protectionMode'];
type FsfoState = TopologyDoc['config']['fsfo']['state'];

const PROTECTION: readonly Mode[] = ['MAXPROTECTION', 'MAXAVAILABILITY', 'MAXPERFORMANCE'];
const FSFO_STATES: readonly { value: FsfoState; label: string }[] = [
  { value: 'disabled', label: 'DISABLED' },
  { value: 'enabled', label: 'ENABLED' },
  { value: 'observe-only', label: 'OBSERVE ONLY' },
];

/** The fold `All settings` opens: where every one of these controls lives in the inspector. */
const FSFO_SECTION = 'Fast-start failover';

/**
 * Build, nothing selected, the inspector open on the fast-start failover
 * section: the way the top bar switches modes, and `revealFindings` reveals a
 * fold -- so the reader lands on the rest of the settings and not on a card.
 */
export function allSettings(): void {
  mode.value = 'build';
  leaveIntro();
  clearSelection();
  revealSections([FSFO_SECTION]);
  revealRail();
}

/** One chip: the name, then the native select drawn as its value and a caret. */
function Chip({ name, mono = false, title, children }: {
  name: string; mono?: boolean; title: string; children: ComponentChildren;
}) {
  return (
    <label class="sc" title={title}>
      <span class={mono ? 'sc-k mono' : 'sc-k'}>{name}</span>
      {children}
    </label>
  );
}

export function SettingChips({ logXpt = true }: { logXpt?: boolean }) {
  const doc = topology.value;
  const f = doc.config.fsfo;
  const dis = !canEdit(viewport.value);
  const standby = logXpt ? tunedStandby(doc, trace.value) : null;
  const xpt = logXptOptions(doc);
  const xptWhy = xpt.map((o) => o.enabled).find((w): w is { state: 'off'; why: string } => w !== undefined && isOff(w));
  const sid = standby === null ? '' : (standby.id as string);
  return (
    <div class="sc-row" role="group" aria-label="Settings">
      <Chip name="Protection mode" title={PROTECTION_NOTE}>
        <select
          class="sc-sel" aria-label="Protection mode" disabled={dis} value={doc.config.protectionMode}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            const next = PROTECTION.find((x) => x === v);
            if (next !== undefined) tuned(() => setProtectionMode(next));
          }}
        >
          {PROTECTION.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Chip>
      <Chip name="FAST_START FAILOVER" mono title={fsfoStateNote(f.state)}>
        <select
          class="sc-sel" aria-label="FAST_START FAILOVER" disabled={dis} value={f.state}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            const next = FSFO_STATES.find((x) => x.value === v);
            if (next !== undefined) tuned(() => setFsfoState(next.value));
          }}
        >
          {FSFO_STATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Chip>
      {standby === null ? null : (
        <Chip name="LogXptMode" mono title={`${sid}: ${LOG_XPT_NOTE}${xptWhy === undefined ? '' : ` ${xptWhy.why}`}`}>
          <select
            class="sc-sel" aria-label={`LogXptMode · ${sid}`} disabled={dis} value={standby.logXptMode}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              const next = xpt.find((o) => o.value === v);
              if (next !== undefined && next.enabled?.state !== 'off') tuned(() => setLogXptMode(standby.id, next.value));
            }}
          >
            {xpt.map((o) => (
              <option key={o.value} value={o.value} disabled={o.enabled?.state === 'off'}>{o.label}</option>
            ))}
          </select>
        </Chip>
      )}
      <button type="button" class="btn sc-all" title="Every setting, in Topology's inspector" onClick={allSettings}>
        All settings →
      </button>
    </div>
  );
}
