import { useMemo, useState } from 'preact/hooks';
import { axisSpan, buildTimeline, elideTo, fmt } from '../timeline/build';
import type { TimelineModel } from '../timeline/build';
import type { ScenarioResult } from './model';
import { Fact } from '../common/Chip';

/** Both runs use one time axis, including each application's reconnect horizon. */
export function comparisonModels(before: ScenarioResult, after: ScenarioResult): [TimelineModel, TimelineModel] | null {
  if (!before.trace || !after.trace) return null;
  const a = axisSpan(before.trace, before.topology.events ?? [], before.topology);
  const b = axisSpan(after.trace, after.topology.events ?? [], after.topology);
  const axis = { t0: Math.min(a.t0, b.t0), t1: Math.max(a.t1, b.t1) };
  const view = { width: 820, gutter: 164, axis, links: 'never' as const, app: true };
  return [buildTimeline(before.trace, before.topology, view), buildTimeline(after.trace, after.topology, view)];
}

export function ComparisonTimeline({ before, after }: { before: ScenarioResult; after: ScenarioResult }) {
  const models = useMemo(() => comparisonModels(before, after), [before, after]);
  const [cursor, setCursor] = useState(0);
  if (!models) return <p class="rv-cap">A timeline comparison needs two available scenario runs.</p>;
  const first = models[0];
  const at = first.scale.clampT(cursor);
  let y = 28;
  const groups = models.map((model, index) => {
    const titleY = y;
    y += 24;
    const rows = model.lanes.map((lane) => { const rowY = y; y += 25; return { lane, y: rowY }; });
    y += 26;
    return { model, titleY, rows, name: index === 0 ? 'Baseline' : 'Current' };
  });
  const ticks = first.ticks.filter((_, index) => index % Math.max(1, Math.ceil(first.ticks.length / 8)) === 0);
  return <section class="comparison-timeline" aria-label="Aligned baseline and current timelines">
    <div class="comparison-heading"><strong>Same scenario, same clock</strong><Fact basis="model" /></div>
    {before.trace?.facts.tOpen != null && after.trace?.facts.tOpen != null ?
      <p class="comparison-delta">New primary opens <strong>{fmt(before.trace.facts.tOpen)} s → {fmt(after.trace.facts.tOpen)} s</strong>
        {before.trace.facts.tOpen !== after.trace.facts.tOpen ? <span> ({after.trace.facts.tOpen > before.trace.facts.tOpen ? '+' : ''}{fmt(after.trace.facts.tOpen - before.trace.facts.tOpen)} s)</span> : null}
      </p> : null}
    <label class="comparison-scrub">Inspect both at <output>{fmt(at)} s</output>
      <input type="range" min={first.scale.t0} max={first.scale.t1} step="0.1" value={at}
        aria-label="Comparison time in seconds" onInput={(e) => setCursor(Number(e.currentTarget.value))} />
    </label>
    <div class="rv-scroll">
      <svg class="comparison-svg" viewBox={`0 0 820 ${y + 20}`} width="820" height={y + 20}
        role="img" aria-label={`Baseline and current run on the same seconds axis, from ${fmt(first.scale.t0)} to ${fmt(first.scale.t1)}. Inspection at ${fmt(at)} seconds.`}>
        <defs><pattern id="comparison-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" class="comparison-hatch-bg" /><line x1="0" x2="0" y1="0" y2="7" class="comparison-hatch-line" />
        </pattern></defs>
        {ticks.map((tick) => <g key={tick.t}>
          <line class="comparison-grid" x1={tick.x} x2={tick.x} y1="10" y2={y - 10} />
          <text class="comparison-tick" x={tick.x} y={y + 8} text-anchor="middle">{fmt(tick.t)} s</text>
        </g>)}
        {groups.map((group) => <g key={group.name}>
          <text class="comparison-title" x="14" y={group.titleY}>{group.name}</text>
          {group.rows.map(({ lane, y: rowY }) => <g key={lane.key}>
            <title>{lane.owner ? `${lane.owner} · ` : ''}{lane.name}</title>
            <text class="comparison-name" x="14" y={rowY + 12}>{elideTo(lane.owner ? `${lane.owner} · ${lane.name}` : lane.name, 136, 11, true)}</text>
            {lane.segments.map((segment) => <rect key={segment.key} class={`comparison-band ${segment.phase}`}
              x={segment.x} y={rowY} width={segment.w} height="17" rx="3">
              <title>{lane.name}: {segment.title} · {fmt(segment.t0)}–{fmt(segment.t1)} s</title>
            </rect>)}
          </g>)}
        </g>)}
        <line class="comparison-cursor" x1={first.scale.x(at)} x2={first.scale.x(at)} y1="8" y2={y - 10} />
      </svg>
    </div>
    <div class="legend tl-legend comparison-legend">{first.legend.map((entry) => <span key={entry.swatch}><i class={entry.swatch} />{entry.label}</span>)}</div>
    <div class="comparison-now">{groups.map((group) => <div key={group.name}><strong>{group.name} at {fmt(at)} s</strong>
      <ul>{group.model.lanes.map((lane) => {
        const phase = lane.segments.find((segment) => at >= segment.t0 && (at < segment.t1 || at === group.model.scale.t1 && at === segment.t1));
        return <li key={lane.key}><span>{lane.owner ? `${lane.owner} · ` : ''}{lane.name}</span> {phase?.labels[0] ?? 'Outside this lane’s recorded interval'}</li>;
      })}</ul>
    </div>)}</div>
  </section>;
}
