import { signal } from '@preact/signals';

/** Provenance of the working document; travels with undo and redo snapshots. */
export const activeWorkspaceId = signal<string | null>(null);
