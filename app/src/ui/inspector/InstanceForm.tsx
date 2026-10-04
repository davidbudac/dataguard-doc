/**
 * One instance of a RAC database, selected on its own row of the card.
 *
 * The same three edits the database's Instances fold makes -- rename, move to
 * another host, remove -- for the one that was clicked, through the same
 * `patchInstance` / `removeInstance` (which keep PreferredApplyInstance
 * coherent). The database itself is one button away, and its own form still
 * has the whole list.
 */

import type { Member, TopologyDoc } from '@/engine';
import { hostId, isDatabase } from '@/engine';
import { select } from '@/state/view';
import { instanceKey } from '@/state/instanceKey';
import { Action, Group, Note, Pick, Text } from './controls';
import { patchInstance, removeInstance } from './edits';
import { off, ON, WHY } from './why';

export function InstanceForm(
  { member, index, doc }: { member: Member; index: number; doc: TopologyDoc },
) {
  const id = member.id;
  const inst = member.instances[index];
  if (inst === undefined) return null;
  const hosts = doc.hosts.map((h) => ({ value: h.id as string, label: h.name }));
  const last = member.instances.length <= 1;
  const applies = isDatabase(member) && member.preferredApplyInstance === inst.name;
  return (
    <Group title="Instance">
      <Text
        name="Instance name"
        value={inst.name}
        focusKey={`name:${instanceKey(id as string, index)}`}
        onCommit={(v) => {
          const name = v.trim();
          if (name === '') return;
          patchInstance(id, index, (x) => ({ ...x, name }), `Rename an instance of ${id as string}`);
        }}
        note={applies
          ? `The PreferredApplyInstance of ${id as string}: renaming it renames the property's value too.`
          : `Instance ${index + 1} of ${member.instances.length} of ${id as string}.`}
      />
      <Pick
        name="Host"
        value={inst.host as string}
        options={hosts}
        onChange={(v) => patchInstance(
          id, index, (x) => ({ ...x, host: hostId(v) }), `Move an instance of ${id as string}`,
        )}
      />
      <div class="rr-line lrow is-acts">
        <Action
          label="Remove"
          enabled={last ? off(WHY.lastInstance) : ON}
          onClick={() => {
            removeInstance(id, index);
            /* The place this key named is gone or now holds the next one. */
            select(id as string);
          }}
        />
        <Action label={`Select ${id as string}`} onClick={() => select(id as string)} />
      </div>
      <Note>
        The database&rsquo;s own properties, and the whole list of its instances, are on{' '}
        {id as string}.
      </Note>
    </Group>
  );
}
