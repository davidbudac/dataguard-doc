/**
 * One observer.
 *
 * Two facts shape this form. The observer is never deployed on a database
 * server or cluster -- so the host list says which hosts run a database
 * rather than quietly hiding them, and `validate()` reports the finding if
 * one is chosen anyway. And only the master coordinates fast-start failover:
 * with fast-start failover disabled every observer has the same
 * functionality, so the master chip is not a permanent rank.
 */

import type { Observer, TopologyDoc } from '@/engine';
import { hostId } from '@/engine';
import { Action, Check, Group, Note, Text } from './controls';
import { Pick } from './controls';
import { patchObserver, removeObserver, renameObserver, setMasterObserver } from './edits';
import { off, ON } from './why';

export interface ObserverFormProps {
  observer: Observer;
  doc: TopologyDoc;
}

export function ObserverForm({ observer, doc }: ObserverFormProps) {
  const id = observer.id;
  const dbHosts = new Set<string>();
  for (const m of doc.members) for (const i of m.instances) dbHosts.add(i.host as string);

  return (
    <>
      <Group title="Observer">
        <Text
          name="Name"
          value={id as string}
          onCommit={(v) => renameObserver(id, v)}
          note="The name START OBSERVER gives it, and how SET MASTEROBSERVER TO names it."
        />
        <Pick
          name="Host"
          value={observer.host as string}
          options={doc.hosts.map((h) => ({
            value: h.id as string,
            label: dbHosts.has(h.id as string) ? `${h.name} -- runs a database` : h.name,
          }))}
          onChange={(v) => patchObserver(
            id, `Move the observer ${id as string}`, (o) => ({ ...o, host: hostId(v) }),
          )}
          note="An observer is never deployed at the primary or standby database server or cluster. A third site is the first placement Oracle documents; the standby's data centre, on a host of its own, is the documented last resort."
        />
        <Check
          name="Running"
          label="The observer process is running"
          checked={observer.running}
          onChange={(v) => patchObserver(
            id, `${v ? 'Start' : 'Stop'} the observer ${id as string}`, (o) => ({ ...o, running: v }),
          )}
        />
        <div class="rr-line">
          <Action
            label="Make it the master"
            enabled={observer.role === 'master'
              ? off('It is the master observer already.')
              : ON}
            onClick={() => setMasterObserver(id)}
          />
          <span class="tag t-vi">{observer.role}</span>
        </div>
        <Note>
          Only the master coordinates fast-start failover. If the master is lost while the
          primary and the target standby stay connected, the broker tries to nominate a
          backup observer as the new master; if either database loses its connections to
          all backup observers, it does not nominate and reports the configuration
          unobserved.
        </Note>
      </Group>

      <Group title="START OBSERVER">
        <Text
          name="FILE IS"
          value={observer.fileIs ?? ''}
          placeholder="the default observer configuration file"
          onCommit={(v) => patchObserver(
            id, `Set FILE IS on ${id as string}`,
            (o) => {
              const next = { ...o };
              if (v.trim() === '') delete next.fileIs;
              else next.fileIs = v.trim();
              return next;
            },
          )}
          note="Spelled FILE IS in DGMGRL, never FILE=."
        />
        <Text
          name="LOGFILE IS"
          value={observer.logfileIs ?? ''}
          placeholder="the default observer log"
          onCommit={(v) => patchObserver(
            id, `Set LOGFILE IS on ${id as string}`,
            (o) => {
              const next = { ...o };
              if (v.trim() === '') delete next.logfileIs;
              else next.logfileIs = v.trim();
              return next;
            },
          )}
        />
        <Text
          name="CONNECT IDENTIFIER IS"
          value={observer.connectIdentifier ?? ''}
          placeholder="the configuration's own"
          onCommit={(v) => patchObserver(
            id, `Set the connect identifier on ${id as string}`,
            (o) => {
              const next = { ...o };
              if (v.trim() === '') delete next.connectIdentifier;
              else next.connectIdentifier = v.trim();
              return next;
            },
          )}
        />
      </Group>

      <Group title="This observer">
        <div class="rr-line">
          <Action label={`Remove ${id as string}`} onClick={() => removeObserver(id)} />
        </div>
        <Note>
          Removing the last observer is not the same as being unobserved: with no observer
          deployed, fast-start failover was never enabled and
          <span class="mono"> FS_FAILOVER_STATUS</span> reads
          <span class="mono"> DISABLED</span>.
        </Note>
      </Group>
    </>
  );
}
