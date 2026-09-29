import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { COLLECTION_LIMIT, COLLECTION_NOTE, importCollectedTopology } from '@/engine';
import type { CollectedTopology } from '@/engine';
import { doc, makeDoc } from '@/state/doc';
import { edition, mode, toast } from '@/state/view';
import { replaceWorkingDocument } from '@/state/workspaces';
import { Sheet } from '../common/Sheet';
import { desktopDownload } from '../common/desktop';
import '@/styles/collect.css';

export const collectOpen = signal(false);
const collectorUrl = (name: string) => `${import.meta.env.BASE_URL}collectors/${name}`;

function Body({ close }: { close: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CollectedTopology | null>(null);
  const [error, setError] = useState('');
  // A later paste/file selection wins over an earlier asynchronous file read.
  const readGeneration = useRef(0);
  useEffect(() => () => { readGeneration.current++; }, []);
  const change = (value: string) => {
    readGeneration.current++;
    setText(value);
    setPreview(null);
    setError('');
  };
  return <div class="collect-body">
    <p>Run the read-only SQL collector on each database and far sync member, from CDB$ROOT or a non-CDB. Paste the complete output blocks together, or choose their combined text file.</p>
    <p><a href={collectorUrl('dataguard-topology.sql')} download onClick={desktopDownload('dataguard-topology.sql')}>Download SQL collector</a>{' · '}
      <a href={collectorUrl('collect-dataguard.sh')} download onClick={desktopDownload('collect-dataguard.sh')}>Optional shell wrapper</a>{' · '}
      <a href={collectorUrl('README.txt')} download onClick={desktopDownload('README.txt')}>Instructions and limits</a></p>
    <p>In SQL*Plus / SQLcl, connect with access to the listed dynamic views, then run:</p>
    <pre>spool member.txt{'\n'}@dataguard-topology.sql{'\n'}spool off</pre>
    <p>Collection does not change Data Guard. Processing stays in this browser. The output includes database and host names.</p>
    <label for="collector-file">Load collector output</label>
    <input id="collector-file" type="file" accept=".txt,.log,.jsonl,text/plain" onChange={async e => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const generation = ++readGeneration.current;
      setPreview(null);
      setText('');
      setError('');
      try {
        if (file.size > COLLECTION_LIMIT) throw new Error('Collector output exceeds 2 MB.');
        const value = await file.text();
        if (generation === readGeneration.current) change(value);
      } catch (err) {
        if (generation === readGeneration.current) setError(err instanceof Error ? err.message : 'Cannot read this file.');
      }
    }} />
    <label for="collector-text">Or paste collector output</label>
    <textarea id="collector-text" rows={9} value={text} maxLength={COLLECTION_LIMIT + 1}
      spellcheck={false} onInput={e => change(e.currentTarget.value)} />
    <button class="btn" type="button" onClick={() => {
      const generation = ++readGeneration.current;
      setPreview(null);
      setText('');
      setError('');
      try { setPreview(importCollectedTopology(text, edition.value)); setError(''); }
      catch (err) { setError(err instanceof Error ? err.message : 'Cannot import this output.'); }
    }}>Preview import</button>
    {error ? <p role="alert">{error}</p> : null}
    {preview ? <section aria-label="Import preview">
      <h3>{preview.topology.members.length} members · {preview.topology.hosts.length} hosts</h3>
      <ul>{preview.topology.members.map(m => <li key={m.id}>{m.name} — {m.kind === 'farsync' ? 'far sync' : m.role}</li>)}</ul>
      <p>This is a starting diagram. Review the assumptions before using simulations or generated scripts.</p>
      <ul>{preview.notes.map(note => <li key={note}>{note}</li>)}</ul>
      <button class="btn is-solid" type="button" onClick={() => {
        const notes = `${COLLECTION_NOTE}\n${preview.notes.join('\n')}`;
        const suffix = '\nAdditional collection details omitted here; retain the original collector output.';
        const savedNotes = notes.length <= 4000 ? notes : notes.slice(0, 4000 - suffix.length) + suffix;
        replaceWorkingDocument('Import existing Data Guard setup', makeDoc(preview.topology, {
          meta: { name: preview.topology.label ?? 'Imported Data Guard', notes: savedNotes },
        }), null);
        mode.value = 'build';
        toast.value = { kind: 'info', text: 'Imported current topology. Review the snapshot assumptions above the drawing; Undo restores your previous configuration.' };
        close();
      }}>Draw imported topology</button>
    </section> : null}
  </div>;
}

export function CollectDialog() {
  const close = () => { collectOpen.value = false; };
  return <Sheet open={collectOpen.value} title="Import existing Data Guard setup" variant="card" class="collect-dialog" onClose={close}>
    {collectOpen.value ? <Body close={close} /> : null}
  </Sheet>;
}

/** Kept in document notes, so export, reload, share and undo retain provenance. */
export function CollectionNotice() {
  const notes = doc.value.meta.notes;
  if (!notes.startsWith(COLLECTION_NOTE)) return null;
  return <details class="collect-notice"><summary>{COLLECTION_NOTE}</summary><p>{notes.slice(COLLECTION_NOTE.length).trim()}</p></details>;
}
