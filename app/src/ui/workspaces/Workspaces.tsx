/**
 * Saved configurations: named copies in this browser, and the drafts that
 * opening a preset, a lesson, a file or a saved copy replaced
 * (state/workspaces.ts).
 *
 * Opened from the top bar's ⋯ menu. The dialog is mounted by the shell, not
 * inside the menu: the menu is a `<details>`, and a dialog inside a shut
 * disclosure is a dialog nobody sees. It floats as a card under the bar on
 * the right, where the menu that opened it was.
 */

import { useState } from 'preact/hooks';
import { doc } from '@/state/doc';
import {
  activeWorkspaceId, deleteWorkspace, openWorkspace, recoveries, refreshWorkspaces,
  renameWorkspace, saveWorkspace, workspaceError, workspaces, workspacesOpen,
} from '@/state/workspaces';
import type { Workspace } from '@/state/workspaces';
import { toast } from '@/state/view';
import { Sheet } from '../common/Sheet';
import '@/styles/workspaces.css';

/** ⋯ → Saved configurations: read the stores afresh, then show them. */
export function openWorkspaces(): void {
  refreshWorkspaces();
  workspacesOpen.value = true;
}

const when = (at: number): string => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

function Body({ close }: { close: () => void }) {
  const active = workspaces.value.find((v) => v.id === activeWorkspaceId.value);
  const [name, setName] = useState(active?.name ?? doc.value.meta.name);
  const [selected, setSelected] = useState<string | null>(activeWorkspaceId.value);
  const [renameName, setRenameName] = useState(active?.name ?? '');
  const [deletePending, setDeletePending] = useState<string | null>(null);
  const chosen = workspaces.value.find((v) => v.id === selected);

  const saved = (duplicate: boolean): void => {
    if (saveWorkspace(duplicate ? `Copy of ${name.trim() || doc.value.meta.name}` : name, duplicate)) {
      setName(workspaces.value.find((v) => v.id === activeWorkspaceId.value)?.name ?? name);
      setSelected(activeWorkspaceId.value);
      toast.value = { kind: 'info', text: duplicate ? 'Saved a separate copy.' : 'Configuration saved in this browser.' };
    }
  };
  const open = (id: string): void => { if (openWorkspace(id)) close(); };
  const pick = (v: Workspace): void => {
    setSelected(v.id);
    setRenameName(v.name);
    setDeletePending(null);
  };

  return (
    <div class="ws-body">
      <p class="ws-lede">
        Named copies kept in this browser. To move one to another device, use Export.
      </p>
      {workspaceError.value ? <p class="ws-error" role="alert">{workspaceError.value}</p> : null}

      <section class="ws-sec" aria-label="Save the configuration on screen">
        <label class="ws-label" for="workspace-name">
          {active ? `Open copy: ${active.name}` : 'Name for a saved copy'}
        </label>
        <input
          id="workspace-name"
          class="field-in"
          maxLength={128}
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <div class="ws-actions">
          <button type="button" class="btn is-solid" onClick={() => saved(false)}>
            {active ? 'Save changes' : 'Save current'}
          </button>
          <button type="button" class="btn" onClick={() => saved(true)}>Duplicate current</button>
        </div>
      </section>

      <section class="ws-sec" aria-label="Named configurations">
        <h3 class="ws-h">Named configurations</h3>
        {workspaces.value.length === 0 ? <p class="ws-none">No saved copies yet.</p> : (
          <ul class="ws-list">
            {workspaces.value.map((v) => (
              <li key={v.id} class={v.id === activeWorkspaceId.value ? 'ws-item is-open' : 'ws-item'}>
                <button
                  type="button"
                  class="ws-pick"
                  aria-pressed={selected === v.id}
                  onClick={() => pick(v)}
                >
                  <span class="ws-name">{v.name}</span>
                  <span class="ws-meta">{v.edition} · {when(v.updatedAt)}</span>
                </button>
                <button type="button" class="btn" onClick={() => open(v.id)}>Open</button>
              </li>
            ))}
          </ul>
        )}
        {chosen ? (
          <div class="ws-manage">
            <label class="ws-label" for="workspace-rename">Rename “{chosen.name}”</label>
            <input
              id="workspace-rename"
              class="field-in"
              maxLength={128}
              value={renameName}
              onInput={(e) => setRenameName((e.currentTarget as HTMLInputElement).value)}
            />
            <div class="ws-actions">
              <button
                type="button"
                class="btn"
                onClick={() => {
                  if (renameWorkspace(chosen.id, renameName)) toast.value = { kind: 'info', text: 'Saved copy renamed.' };
                }}
              >
                Rename
              </button>
              {deletePending === chosen.id ? (
                <button
                  type="button"
                  class="btn is-danger"
                  onClick={() => {
                    if (deleteWorkspace(chosen.id)) { setSelected(null); setDeletePending(null); }
                  }}
                >
                  Confirm delete
                </button>
              ) : (
                <button type="button" class="btn is-quiet" onClick={() => setDeletePending(chosen.id)}>
                  Delete…
                </button>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {recoveries.value.length > 0 ? (
        <section class="ws-sec" aria-label="Recent working configurations">
          <h3 class="ws-h">Recent working configurations</h3>
          <p class="ws-lede">
            Kept when you open an example, a lesson, a file or a saved copy. Undo also returns
            to the latest one during this visit.
          </p>
          <ul class="ws-list">
            {recoveries.value.map((v, i) => (
              <li key={v.id} class="ws-item">
                <span class="ws-pick is-static">
                  <span class="ws-name">{v.name}</span>
                  <span class="ws-meta">{v.edition} · {when(v.updatedAt)}{i === 0 ? ' · latest' : ''}</span>
                </span>
                <button type="button" class="btn" onClick={() => open(`recovery:${v.id}`)}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The dialog itself; the shell mounts it once (App.tsx). */
export function WorkspacesDialog() {
  const close = (): void => { workspacesOpen.value = false; };
  return (
    <Sheet open={workspacesOpen.value} title="Saved configurations" variant="card" onClose={close}>
      <Body close={close} />
    </Sheet>
  );
}
