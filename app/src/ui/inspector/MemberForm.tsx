/**
 * One member: a database or a far sync instance, every property the engine
 * models, and the destinations it sends redo to.
 *
 * The two kinds are genuinely different objects, and the form says so rather
 * than greying half of itself out: a far sync instance has no role, no apply
 * lag, no open mode and no broker state, so those controls are not there and
 * a sentence says why. What *is* greyed always carries its reason, out of the
 * one WHY table.
 */

import type { Member, MemberId, RedoGraph, TopologyDoc, XptMode } from '@/engine';
import { hostId, isDatabase } from '@/engine';
import { removeAction } from '../build/actions';
import { Fact } from '../common/Chip';
import { Action, Check, Choice, Fold, Group, Note, Num, Pick, Text } from './controls';
import { DESTS_ID, INSTANCES_ID } from './sections';
import { RedoRoutesEditor } from './RedoRoutesEditor';
import {
  addInstance, destPropsOf, patchDatabase, patchDest, patchInstance, patchMember, removeInstance,
  renameMember, setLogXptMode, setPrimary,
} from './edits';
import { gateOff, off, ON, WHY } from './why';

export interface MemberFormProps {
  member: Member;
  doc: TopologyDoc;
  graph: RedoGraph | null;
}

const ROLE_LABEL = {
  primary: 'primary', physical: 'physical', logical: 'logical', snapshot: 'snapshot',
} as const;

/** The transport this member's redo arrives on at `to`, as the resolver reads it. */
function effectiveXpt(
  m: Member, to: MemberId, doc: TopologyDoc, graph: RedoGraph | null,
): XptMode | null {
  const edge = graph?.edges.find((e) => e.from === m.id && e.to === to);
  if (edge) return edge.xpt;
  const receiver = doc.members.find((x) => x.id === to);
  return receiver ? receiver.logXptMode : null;
}

export function MemberForm({ member, doc, graph }: MemberFormProps) {
  const id = member.id;
  const db = isDatabase(member) ? member : null;
  const isPrimary = db !== null && db.role === 'primary';
  const hosts = doc.hosts.map((h) => ({ value: h.id as string, label: h.name }));
  const others = doc.members.filter((m) => m.id !== id);

  /* The destinations worth showing: the ones this member actually feeds in the
     resolved graph, plus any it carries properties for even while they are
     standing down. */
  const fed = new Set<string>(
    (graph?.edges ?? []).filter((e) => e.from === id).map((e) => e.to as string),
  );
  for (const k of Object.keys(member.dests)) fed.add(k);
  const dests = others.filter((m) => fed.has(m.id as string));
  const notDests = others.filter((m) => !fed.has(m.id as string));

  /* The removal is the Build table's own entry, not a second reading of the
     same two rules: the Delete key on the drawing presses this very object. */
  const remove = removeAction(doc, id as string);

  return (
    <>
      <Group title={member.kind === 'farsync' ? 'Far sync instance' : 'Database'}>
        <Text
          name="db_unique_name"
          value={id as string}
          onCommit={(v) => renameMember(id, v)}
          focusKey={`name:${id as string}`}
          note="The member's identity. Renaming it rewrites every reference in this configuration in the same edit."
        />
        <Text
          name="Connect identifier"
          value={member.connectIdentifier}
          onCommit={(v) => patchMember(
            id, `Set the connect identifier on ${id as string}`, (m) => ({ ...m, connectIdentifier: v }),
          )}
          note="What DGMGRL and the observer dial to reach this member."
        />
        <Check
          name="Enabled"
          label="In the broker configuration"
          checked={member.enabled}
          onChange={(v) => patchMember(
            id, `${v ? 'Enable' : 'Disable'} ${id as string}`, (m) => ({ ...m, enabled: v }),
          )}
        />
      </Group>

      {db === null ? (
        <Group title="Role">
          <Note>
            A far sync instance has no role, no apply lag, no open mode and no broker
            state of its own: it receives redo and forwards it. It can never be a
            primary and is never converted into one.
          </Note>
          <Num
            name="Transport lag"
            bound="transportLagSeconds"
            value={member.transportLagSeconds}
            coalesce={`xlag:${id as string}`}
            onChange={(v) => patchMember(
              id, `Set the transport lag on ${id as string}`,
              (m) => (m.kind === 'farsync' ? { ...m, transportLagSeconds: v } : m),
              `xlag:${id as string}`,
            )}
            note="Redo the instance has not received yet."
          />
        </Group>
      ) : (
        <Group title="Role and apply">
          <Choice
            name="Role"
            value={db.role}
            options={[
              { value: 'primary', label: ROLE_LABEL.primary },
              { value: 'physical', label: ROLE_LABEL.physical },
              { value: 'logical', label: ROLE_LABEL.logical },
              { value: 'snapshot', label: ROLE_LABEL.snapshot },
            ]}
            onChange={(v) => {
              if (v === 'primary') { setPrimary(id); return; }
              patchDatabase(id, `Make ${id as string} a ${v} standby`, (m) => ({ ...m, role: v }));
            }}
            note={isPrimary
              ? 'A configuration has exactly one primary, so giving the role to another database takes it from this one in the same edit.'
              : undefined}
          />
          <Choice
            name="Open mode"
            value={db.openMode}
            options={[
              { value: 'mount', label: 'MOUNTED' },
              { value: 'read-only-adg', label: 'READ ONLY' },
              { value: 'read-write', label: 'READ WRITE' },
            ]}
            onChange={(v) => patchDatabase(
              id, `Set the open mode on ${id as string}`, (m) => ({ ...m, openMode: v }),
            )}
          />
          <Num
            name="Apply lag"
            bound="applyLagSeconds"
            value={db.applyLagSeconds}
            coalesce={`alag:${id as string}`}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => patchDatabase(
              id, `Set the apply lag on ${id as string}`,
              (m) => ({ ...m, applyLagSeconds: v, transportLagSeconds: Math.min(m.transportLagSeconds, v) }),
              `alag:${id as string}`,
            )}
            note="Redo this standby holds but has not applied. It lengthens the catch-up a role change pays; it does not make the standby unsynchronized."
          />
          <Num
            name="Transport lag"
            bound="transportLagSeconds"
            value={db.transportLagSeconds}
            coalesce={`xlag:${id as string}`}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => patchDatabase(
              id, `Set the transport lag on ${id as string}`,
              (m) => ({ ...m, transportLagSeconds: Math.min(v, m.applyLagSeconds) }),
              `xlag:${id as string}`,
            )}
            note="Redo the standby has not received. Clamped to the apply lag, because redo cannot be applied before it arrives."
          />
          <Check
            name="Apply running"
            label="Redo apply is running"
            checked={db.applyRunning}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => patchDatabase(
              id, `${v ? 'Start' : 'Stop'} redo apply on ${id as string}`,
              (m) => ({ ...m, applyRunning: v }),
            )}
          />
          <Check
            name="Real-time apply"
            label="Applies from the standby redo logs"
            checked={db.realTimeApply}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => patchDatabase(
              id, `Set real-time apply on ${id as string}`, (m) => ({ ...m, realTimeApply: v }),
            )}
          />
          <Check
            name="Flashback Database"
            label="Flashback Database is on"
            checked={db.flashbackOn}
            onChange={(v) => patchDatabase(
              id, `Set Flashback Database on ${id as string}`, (m) => ({ ...m, flashbackOn: v }),
            )}
            note="Automatic reinstatement needs it on both databases."
          />
          <Check
            name="Static services"
            label="A static service name is registered"
            checked={db.staticServices}
            onChange={(v) => patchDatabase(
              id, `Set static services on ${id as string}`, (m) => ({ ...m, staticServices: v }),
            )}
            note="One of the reinstatement preconditions, where Clusterware or Oracle Restart is not doing it."
          />
        </Group>
      )}

      <Group title="Transport">
        <Choice
          name="LogXptMode"
          value={member.logXptMode}
          options={[
            { value: 'SYNC', label: 'SYNC' },
            {
              value: 'FASTSYNC',
              label: 'FASTSYNC',
              enabled: doc.config.protectionMode === 'MAXAVAILABILITY' ? ON : off(WHY.fastsyncMode),
            },
            { value: 'ASYNC', label: 'ASYNC' },
          ]}
          onChange={(v) => setLogXptMode(id, v)}
          note="How this member receives redo. Broker default ASYNC. SYNC maps to SYNC + AFFIRM, FASTSYNC to SYNC + NOAFFIRM, ASYNC to ASYNC + NOAFFIRM: AFFIRM acknowledges received redo after writing it to the standby redo log, NOAFFIRM before that write."
        />
      </Group>

      {/* The tail of the form folds (ui.md SS3f). Everything above is what the
          member *is*; instances and destinations are lists that grow, and a
          two-destination primary put six screens of properties under the four
          the reader came for. The fold's hint says what is inside, the state
          is remembered for the session, and a closed fold renders nothing --
          it is not painted out of view. */}
      <Fold
        id={INSTANCES_ID}
        title={member.instances.length > 1 ? `Instances (RAC, ${member.instances.length})` : 'Instance'}
        hint={member.instances.map((inst) => inst.name).join(', ')}
      >
        {member.instances.map((inst, i) => (
          <div class="rr-dest" key={`inst-${i}`}>
            <input
              class="field-in"
              type="text"
              aria-label={`Instance ${i + 1} name`}
              value={inst.name}
              spellcheck={false}
              onChange={(e) => patchInstance(
                id, i, (x) => ({ ...x, name: (e.currentTarget as HTMLInputElement).value }),
                `Rename an instance of ${id as string}`,
              )}
            />
            <select
              class="field-in"
              aria-label={`Instance ${i + 1} host`}
              value={inst.host as string}
              onChange={(e) => patchInstance(
                id, i, (x) => ({ ...x, host: hostId((e.currentTarget as HTMLSelectElement).value) }),
                `Move an instance of ${id as string}`,
              )}
            >
              {hosts.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
            <Action
              label="Remove"
              enabled={member.instances.length > 1 ? ON : off(WHY.lastInstance)}
              onClick={() => removeInstance(id, i)}
            />
          </div>
        ))}
        <div class="rr-line">
          <Action label="+ Instance" onClick={() => addInstance(id)} />
        </div>
        <Note>
          More than one instance is RAC: the member is reachable while any instance host
          is up and reachable, and losing some of them leaves it degraded rather than
          down. Which instance owns the redo transport is out of scope here.
          <Fact basis="model" id="RAC.INSTANCE_SCOPE" />
        </Note>
      </Fold>

      <RedoRoutesEditor member={member} doc={doc} />

      <Fold
        id={DESTS_ID}
        title="Destinations"
        hint={dests.length === 0 ? 'none' : dests.map((m) => m.id as string).join(', ')}
      >
        {dests.length === 0 ? (
          /* An empty state: with the sentence gone the group would be a
             heading over nothing at all. */
          <Note always>
            This member feeds nothing in the configuration as it stands. Destination
            properties appear here for every member it sends redo to.
          </Note>
        ) : null}
        {dests.map((to) => {
          const p = destPropsOf(member, to.id);
          const xpt = effectiveXpt(member, to.id, doc, graph);
          const async = xpt === 'ASYNC';
          return (
            <div class="dest" key={to.id as string}>
              <div class="rr-line">
                <span class="field-name">{to.id as string}</span>
                <span class="rr-spacer" />
                <span class="tag t-sl">{xpt ?? 'not resolved'}</span>
              </div>
              <Num
                name="NetTimeout"
                bound="netTimeoutSeconds"
                value={p.netTimeoutSeconds}
                coalesce={`nt:${id as string}:${to.id as string}`}
                enabled={async ? off(WHY.netTimeoutAsync) : ON}
                onChange={(v) => patchDest(
                  id, to.id, `Set NetTimeout to ${v} s on ${id as string} to ${to.id as string}`,
                  (d) => ({ ...d, netTimeoutSeconds: v }), `nt:${id as string}:${to.id as string}`,
                )}
                warn={p.netTimeoutSeconds < 8 && !async}
                note={p.netTimeoutSeconds < 8 && !async
                  ? 'Below the 8 to 10 seconds Oracle recommends. It bounds how long LGWR waits for the standby acknowledgement; it is never a failover clock.'
                  : 'Default 30 s, minimum 1 s, 8 to 10 s recommended. It bounds how long LGWR waits for the standby acknowledgement; it is never a failover clock.'}
              />
              <Num
                name="ReopenSecs"
                bound="reopenSeconds"
                value={p.reopenSeconds}
                coalesce={`rs:${id as string}:${to.id as string}`}
                onChange={(v) => patchDest(
                  id, to.id, `Set ReopenSecs to ${v} s on ${id as string} to ${to.id as string}`,
                  (d) => ({ ...d, reopenSeconds: v }), `rs:${id as string}:${to.id as string}`,
                )}
                note="Default 300 s. It only gates eligibility: transport retries a failed destination at log switch time, once the last error plus this interval is in the past, and it applies to every error rather than connection failures alone. The meaning of 0 is not documented, so this control stops at 30 s."
              />
              <Num
                name="MaxFailure"
                bound="maxFailure"
                kind="number"
                value={p.maxFailure}
                onChange={(v) => patchDest(
                  id, to.id, `Set MaxFailure to ${v} on ${id as string} to ${to.id as string}`,
                  (d) => ({ ...d, maxFailure: v }),
                )}
                note="Consecutive attempts to reestablish the destination at log switches; 0 is unlimited and is the default. At the limit the destination is disabled with no further access until it is manually reenabled -- healing the network does not bring it back. Whether a successful reopen resets the count is not documented."
              />
              <Pick
                name="AFFIRM"
                value={p.affirm ?? ''}
                options={[
                  { value: '', label: 'from the transport mode' },
                  { value: 'AFFIRM', label: 'AFFIRM' },
                  { value: 'NOAFFIRM', label: 'NOAFFIRM' },
                ]}
                onChange={(v) => patchDest(
                  id, to.id, `Set AFFIRM on ${id as string} to ${to.id as string}`,
                  (d) => {
                    const next = { ...d };
                    if (v === 'AFFIRM' || v === 'NOAFFIRM') next.affirm = v;
                    else delete next.affirm;
                    return next;
                  },
                )}
                note="Two documented defaults coexist: NOAFFIRM at parameter level, and the contextual default of AFFIRM with SYNC and NOAFFIRM with ASYNC. AFFIRM without SYNC is deprecated."
              />
            </div>
          );
        })}
        {notDests.length === 0 ? null : (
          <Pick
            name="Add destination properties"
            prose
            value=""
            options={[
              { value: '', label: 'pick a member' },
              ...notDests.map((m) => ({ value: m.id as string, label: m.id as string })),
            ]}
            onChange={(v) => {
              const to = others.find((m) => (m.id as string) === v);
              if (!to) return;
              patchDest(
                id, to.id, `Give ${id as string} destination properties for ${v}`, (d) => ({ ...d }),
              );
            }}
            note="Properties can be set for a member this one does not feed today: RedoRoutes decides who receives, these decide how."
          />
        )}
      </Fold>

      <Group title="This member">
        <div class="rr-line">
          {remove === null ? null : (
            <Action label={remove.label} enabled={remove.enabled} onClick={remove.run} />
          )}
        </div>
      </Group>
    </>
  );
}
