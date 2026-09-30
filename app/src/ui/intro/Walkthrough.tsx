/**
 * The classic walkthrough (docs/tasks/ui-followups.md 7.5): three steps over
 * the real classic configuration and the real engine -- crash the primary,
 * advance to the failover, change FastStartFailoverThreshold and see the
 * timing move. Started from the Introduction's hero.
 *
 * It is a card in the header, under the guidance line, so it is in the
 * header's flow: the measured `--bar-bottom` grows with it and the drawing,
 * the palette and the rail move down rather than disappear under it. It ends
 * on its own the moment the reader takes the drawing somewhere else (another
 * preset, a saved copy, an edit other than the threshold and the events).
 */
import { signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { TopologyDoc } from '@/engine';
import { topology } from '@/state/derived';
import { activeWorkspaceId } from '@/state/workspace-id';
import { presetId } from '@/state/url';
import { canEdit, mode, selection, tNow, viewport } from '@/state/view';
import { revealRail } from '@/state/persist';
import { applyTemplate, clearEvents, restPlayhead, templates } from '@/ui/break/events';
import { revealSections } from '@/ui/inspector/sections';
import { jump } from './route';

type Phase = 'off' | 'crash' | 'advance' | 'threshold';
export const walkthroughPhase = signal<Phase>('off');
let startingShape = '';
let startingPreset: string | null = null;
let startingWorkspace: string | null = null;

/** The exercise changes the events and the threshold, and nothing else. */
function shapeOf(doc: TopologyDoc): string {
  return JSON.stringify({
    ...doc,
    config: {
      ...doc.config,
      fsfo: { ...doc.config.fsfo, thresholdSeconds: 30 },
    },
    events: [],
  });
}

export function startClassicWalkthrough(): void {
  const edit = canEdit(viewport.value);
  /* On a screen that cannot edit, the crash comes ready-made. */
  jump({ preset: 'classic', ...(edit ? {} : { scenario: 'crash' as const }), mode: 'build' });
  if (edit) clearEvents();
  else tNow.value = 0;
  startingShape = shapeOf(topology.value);
  startingPreset = presetId.value;
  startingWorkspace = activeWorkspaceId.value;
  walkthroughPhase.value = edit ? 'crash' : 'advance';
}

/** Bring the threshold slider into view once the rail has drawn it. */
function showThreshold(): void {
  setTimeout(() => {
    if (typeof document === 'undefined') return;
    const input = document.querySelector<HTMLElement>('input[aria-label="FastStartFailoverThreshold"]');
    input?.scrollIntoView?.({ block: 'center' });
    input?.focus({ preventScroll: true });
  }, 0);
}

export function ClassicWalkthrough() {
  const phase = walkthroughPhase.value;
  const current = topology.value;
  const currentPreset = presetId.value;
  const currentWorkspace = activeWorkspaceId.value;
  const shape = useMemo(() => shapeOf(current), [current]);
  const action = useRef<HTMLButtonElement>(null);
  const valid = shape === startingShape
    && currentPreset === startingPreset && currentWorkspace === startingWorkspace;
  useLayoutEffect(() => {
    if (phase !== 'off' && !valid) walkthroughPhase.value = 'off';
  }, [phase, valid]);
  useLayoutEffect(() => {
    if (phase !== 'off' && valid) action.current?.focus();
  }, [phase]);
  if (phase === 'off' || !valid) return null;
  const changed = current.config.fsfo.thresholdSeconds !== 30;
  const done = phase === 'threshold' && changed;
  const editable = canEdit(viewport.value);
  const step = phase === 'crash' ? 1 : phase === 'advance' ? 2 : 3;
  return (
    <aside class="walk float-card" aria-label="Classic failover walkthrough">
      <span class="walk-step mono" aria-hidden="true">{done ? '✓' : `${step}/3`}</span>
      <div class="walk-text" aria-live="polite">
        <strong>{done ? 'Threshold changed' : `Primary crash · step ${step} of 3`}</strong>
        <span>
          {phase === 'crash'
            ? 'Crash the primary host to start the example.'
            : phase === 'advance'
              ? 'Advance the timeline to see when the standby opens.'
              : done
                ? 'The timeline under the drawing shows how the new threshold moves the failover.'
                : 'Change FastStartFailoverThreshold under Fast-start failover in the inspector.'}
        </span>
      </div>
      <div class="walk-acts">
        {phase === 'crash' ? (
          <button
            ref={action}
            type="button"
            class="btn is-solid"
            onClick={() => {
              const crash = templates(topology.value).find((t) => t.id === 'crash');
              if (!crash) return;
              mode.value = 'build';
              applyTemplate(crash);
              tNow.value = 0;
              walkthroughPhase.value = 'advance';
            }}
          >
            Crash primary
          </button>
        ) : null}
        {phase === 'advance' ? (
          <button
            ref={action}
            type="button"
            class="btn is-solid"
            onClick={() => {
              mode.value = 'build';
              restPlayhead();
              walkthroughPhase.value = 'threshold';
            }}
          >
            Advance to failover
          </button>
        ) : null}
        {phase === 'threshold' ? (
          <button
            ref={action}
            type="button"
            class="btn is-solid"
            disabled={!done && !editable}
            onClick={() => {
              mode.value = 'build';
              if (done) { restPlayhead(); return; }
              selection.value = [];
              revealSections(['Fast-start failover']);
              revealRail();
              showThreshold();
            }}
          >
            {done ? 'See the changed result' : 'Open threshold control'}
          </button>
        ) : null}
        {phase === 'threshold' && !done && !editable
          ? <span class="why">Editing needs a wider screen.</span> : null}
        <button type="button" class="btn is-quiet" onClick={() => { walkthroughPhase.value = 'off'; }}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}
