import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { doc } from '@/state/doc';
import { readout } from '@/state/derived';

const WATCH = new Set(['outcome', 'open', 'abort', 'loss', 'split', 'app']);
export function OutcomeChange() {
  const current = doc.value;
  const readings = readout.value.filter(c => WATCH.has(c.group ?? c.id)).map(c => ({
    id: c.id, label: c.k, value: `${c.v}${c.unit ? ` ${c.unit}` : ''}`,
  }));
  const events = JSON.stringify(current.topology.events);
  const previous = useRef({ current, events, readings });
  const [changes, setChanges] = useState<string[]>([]);
  useLayoutEffect(() => {
    const was = previous.current;
    if (was.current === current) return;
    if (was.events !== events) setChanges([]);
    else {
      const changed = readings.flatMap(r => {
        const old = was.readings.find(c => c.id === r.id);
        return old?.value !== r.value ? [`${r.label}: ${old?.value ?? '—'} → ${r.value}`] : [];
      });
      for (const old of was.readings) if (!readings.some(r => r.id === old.id)) changed.push(`${old.label}: ${old.value} → —`);
      setChanges(changed.length ? changed : ['The outcome and reported timings are unchanged.']);
    }
    previous.current = { current, events, readings };
  }, [current, events, readings]);
  if (!changes.length) return null;
  return <div class="outcome-change" role="status"><strong>Since the last edit</strong>
    <span>{changes.join(' · ')}</span><button class="btn is-quiet" aria-label="Dismiss outcome comparison" onClick={() => setChanges([])}>×</button>
  </div>;
}
