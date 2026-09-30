/**
 * The settings that matter most to a run, on the timeline's own chrome.
 *
 * Simulate used to offer no way to change a setting: the reader went to Build,
 * edited the inspector, and came back to see what it did. This is one compact
 * row above the Configuration timeline, in both layouts, of the controls the
 * run answers to -- protection mode, fast-start failover, its threshold and lag
 * limit, the transport of the standby the run is about, that standby's apply
 * lag, the role transition -- and a way through to the rest of the inspector.
 *
 * Every control is the inspector's own setting, written through the same named
 * setters (`inspector/edits.ts`), so its undo sentence and its coalescing are
 * the rail's, and greyed by the same functions (`lagLimitGate`,
 * `logXptOptions`) with the same reasons, drawn with the same `WhyPill`. The
 * sentence each control's tooltip carries is the one the inspector prints
 * under it (`inspector/notes.ts`); nothing new is claimed here. Each edit is
 * marked as tuned (`tuned`), so the timeline keeps the axis the run was on
 * while the run still fits it and the reader sees the bars move.
 *
 * The row is absent, not hidden, while the `Settings` toggle is off and while
 * the Application timeline is the one drawn (it has its own strip, with the
 * connect string in it).
 */

import type { ComponentChildren } from 'preact';
import { lagLimitOf } from '@/engine';
import type { DatabaseMember, TopologyDoc } from '@/engine';
import { topology, trace } from '@/state/derived';
import { revealRail, toggleTune } from '@/state/persist';
import { canEdit, clearSelection, mode, tuneOn, viewport } from '@/state/view';
import type { WhyState } from '../common/WhyPill';
import { WhyPill } from '../common/WhyPill';
import { leaveIntro } from '../intro/route';
import {
  setApplyLag, setFsfoLagLimit, setFsfoState, setFsfoThreshold, setLogXptMode, setProtectionMode,
  setRoleTransition,
} from '../inspector/edits';
import {
  APPLY_LAG_NOTE, fsfoStateNote, lagLimitNote, LOG_XPT_NOTE, PROTECTION_NOTE, ROLE_TRANSITION_NOTE,
  THRESHOLD_NOTE,
} from '../inspector/notes';
import { revealSections } from '../inspector/sections';
import { lagLimitGate, logXptOptions, off, ON, WHY } from '../inspector/why';
import { TuneNumber } from '../timeline/TuneNumber';
import { tuned, tunedStandby } from '../timeline/tune';
import { appTimelineOn } from './TimelineView';

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

/** Whether the strip is on screen: the reader wants it, and the timeline is the configuration's. */
export const tuneShown = (): boolean => tuneOn.value && !appTimelineOn();

/** A control's reason for being grey, beside it, cut to one line with the whole of it on hover. */
function Why({ why }: { why: WhyState }) {
  if (why.state === 'on') return null;
  return <span class="tune-why" title={why.why}><WhyPill why={why} /></span>;
}

/** One labelled control: the name over it, so a row of them stays one row. */
function Field({ name, mono = false, note, why, children }: {
  name: ComponentChildren; mono?: boolean; note?: string; why?: WhyState | undefined; children: ComponentChildren;
}) {
  return (
    <span class={why === undefined ? 'tune-g' : 'tune-g has-why'}>
      <label class="tune-f" title={note}>
        <span class={mono ? 'tune-k mono' : 'tune-k'}>{name}</span>
        <span class="tune-c">{children}</span>
      </label>
      {why === undefined ? null : <Why why={why} />}
    </span>
  );
}

function Unit() {
  return <span class="tune-u">s</span>;
}

/** Simulate's row of settings. Nothing when it is switched off, or the Application timeline is showing. */
export function TuneStrip() {
  if (!tuneShown()) return null;
  const doc = topology.value;
  const run = trace.value;
  const f = doc.config.fsfo;
  const editable = canEdit(viewport.value);
  const readOnly: WhyState = editable ? ON : off(WHY.readOnlyView);
  const dis = !editable;
  const standby: DatabaseMember | null = tunedStandby(doc, run);
  const lagGate = lagLimitGate(doc);
  const xpt = logXptOptions(doc);
  const xptWhy = xpt.find((o) => o.enabled?.state === 'off')?.enabled;
  const lagOff = dis || lagGate.state === 'off';

  return (
    <div class="tune-strip" role="group" aria-label="Settings">
      <Field name="Protection mode" note={PROTECTION_NOTE}>
        <select
          class="tune-sel" aria-label="Protection mode" disabled={dis}
          value={doc.config.protectionMode}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            const next = PROTECTION.find((x) => x === v);
            if (next !== undefined) tuned(() => setProtectionMode(next));
          }}
        >
          {PROTECTION.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

      <Field name="FAST_START FAILOVER" mono note={fsfoStateNote(f.state)}>
        <select
          class="tune-sel" aria-label="FAST_START FAILOVER" disabled={dis}
          value={f.state}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            const next = FSFO_STATES.find((x) => x.value === v);
            if (next !== undefined) tuned(() => setFsfoState(next.value));
          }}
        >
          {FSFO_STATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field name="FastStartFailoverThreshold" mono note={THRESHOLD_NOTE}>
        <TuneNumber
          bound="thresholdSeconds" value={f.thresholdSeconds} label="FastStartFailoverThreshold"
          disabled={dis} onValue={(v) => tuned(() => setFsfoThreshold(v))}
        />
        <Unit />
      </Field>

      <Field
        name="FastStartFailoverLagLimit" mono note={lagLimitNote(doc)}
        why={lagGate.state === 'off' ? lagGate : undefined}
      >
        <TuneNumber
          bound="lagLimitSeconds" value={lagLimitOf(doc)} label="FastStartFailoverLagLimit"
          disabled={lagOff} onValue={(v) => tuned(() => setFsfoLagLimit(v))}
        />
        <Unit />
      </Field>

      {standby === null ? null : (
        <>
          <Field name={`LogXptMode · ${standby.id as string}`} mono note={LOG_XPT_NOTE} why={xptWhy}>
            <select
              class="tune-sel" aria-label={`LogXptMode · ${standby.id as string}`} disabled={dis}
              value={standby.logXptMode}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                const next = xpt.find((o) => o.value === v);
                if (next !== undefined && next.enabled?.state !== 'off') {
                  tuned(() => setLogXptMode(standby.id, next.value));
                }
              }}
            >
              {xpt.map((o) => (
                <option key={o.value} value={o.value} disabled={o.enabled?.state === 'off'}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field name={`Apply lag · ${standby.id as string}`} note={APPLY_LAG_NOTE}>
            <TuneNumber
              bound="applyLagSeconds" value={standby.applyLagSeconds} label={`Apply lag · ${standby.id as string}`}
              disabled={dis} onValue={(v) => tuned(() => setApplyLag(standby.id, v))}
            />
            <Unit />
          </Field>
        </>
      )}

      <Field name="Role transition" note={ROLE_TRANSITION_NOTE}>
        <TuneNumber
          bound="roleTransitionSeconds" value={doc.environment.roleTransitionSeconds} label="Role transition"
          disabled={dis} onValue={(v) => tuned(() => setRoleTransition(v))}
        />
        <Unit />
      </Field>

      <span class="tune-spacer" />
      <Why why={readOnly} />
      <button
        type="button" class="btn tune-all"
        title="Every setting, in Build's inspector"
        onClick={allSettings}
      >
        All settings
      </button>
    </div>
  );
}

/**
 * Build, nothing selected, the inspector open on the fast-start failover
 * section: the way the top bar switches modes, and `revealFindings` reveals a
 * fold -- so the reader lands on the rest of the settings and not on a card.
 */
function allSettings(): void {
  mode.value = 'build';
  leaveIntro();
  clearSelection();
  revealSections([FSFO_SECTION]);
  revealRail();
}

/** The `Settings` button on a bar: whether the row above the timeline is drawn. Nothing while the Application timeline is. */
export function TuneToggle() {
  if (appTimelineOn()) return null;
  const on = tuneOn.value;
  return (
    <button
      type="button" class="btn sb-tune" aria-pressed={on}
      title={on ? 'Hide the row of settings above the timeline' : 'Show a row of settings above the timeline'}
      onClick={toggleTune}
    >
      Settings
    </button>
  );
}
