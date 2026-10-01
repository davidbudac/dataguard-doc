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
import { hostId, isDatabase, isRac } from '@/engine';
import { Fact } from '../common/Chip';
import { Action, Check, Choice, Fold, Group, Note, Num, Pick, Text } from './controls';
import { DESTS_ID, INSTANCES_ID } from './sections';
import { RedoRoutesEditor } from './RedoRoutesEditor';
import {
  addInstance, destPropsOf, patchDatabase, patchDest, patchInstance, patchMember, removeInstance,
  renameMember, setApplyLag, setLogXptMode, setPrimary,
} from './edits';
import { APPLY_LAG_NOTE, LOG_XPT_NOTE } from './notes';
import { gateOff, logXptOptions, off, ON, WHY } from './why';

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

  return (
    <>
      {/* The header already says what this is (a primary database, a far sync
          instance); the first group is its identity. */}
      <Group title="General">
        <Text
          name="db_unique_name"
          value={id as string}
          onCommit={(v) => renameMember(id, v)}
          focusKey={`name:${id as string}`}
          note="The member's identity. Renaming it rewrites every reference in this configuration in the same edit."
        />
        <Text
          name="Connect identifier" prose
          value={member.connectIdentifier}
          onCommit={(v) => patchMember(
            id, `Set the connect identifier on ${id as string}`, (m) => ({ ...m, connectIdentifier: v }),
          )}
          note="What DGMGRL and the observer dial to reach this member."
        />
        <Check
          name="Enabled" prose
          label="In the broker configuration"
          checked={member.enabled}
          onChange={(v) => patchMember(
            id, `${v ? 'Enable' : 'Disable'} ${id as string}`, (m) => ({ ...m, enabled: v }),
          )}
        />
      </Group>

      {db === null ? (
        <Group title="Redo">
          <Note>
            A far sync instance has no role, no apply lag, no open mode and no broker
            state of its own: it receives redo and forwards it. It can never be a
            primary and is never converted into one.
          </Note>
          <Num
            name="Transport lag" prose
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
            name="Role" prose
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
            name="Open mode" prose
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
            name="Apply lag" prose
            bound="applyLagSeconds"
            value={db.applyLagSeconds}
            coalesce={`alag:${id as string}`}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => setApplyLag(id, v)}
            note={APPLY_LAG_NOTE}
          />
          <Num
            name="Transport lag" prose
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
            name="Apply running" prose
            label={db.role === 'logical' ? 'SQL Apply is running' : 'Redo apply is running'}
            checked={db.role === 'snapshot' ? false : db.applyRunning}
            enabled={isPrimary ? gateOff(true, WHY.primaryNoApply) : gateOff(db.role === 'snapshot', WHY.snapshotNoApply)}
            onChange={(v) => patchDatabase(
              id, `${v ? 'Start' : 'Stop'} ${db.role === 'logical' ? 'SQL Apply' : 'redo apply'} on ${id as string}`,
              (m) => ({ ...m, applyRunning: v }),
            )}
          />
          <Check
            name="Real-time apply" prose
            label="Applies from the standby redo logs"
            checked={db.realTimeApply}
            enabled={gateOff(isPrimary, WHY.primaryNoApply)}
            onChange={(v) => patchDatabase(
              id, `Set real-time apply on ${id as string}`, (m) => ({ ...m, realTimeApply: v }),
            )}
          />
          <Check
            name="Flashback Database" prose
            label="Flashback Database is on"
            checked={db.flashbackOn}
            onChange={(v) => patchDatabase(
              id, `Set Flashback Database on ${id as string}`, (m) => ({ ...m, flashbackOn: v }),
            )}
            note="Automatic reinstatement needs it on both databases."
          />
          <Check
            name="Static services" prose
            label="A static service name is registered"
            checked={db.staticServices}
            onChange={(v) => patchDatabase(
              id, `Set static services on ${id as string}`, (m) => ({ ...m, staticServices: v }),
            )}
            note={isRac(member)
              ? 'Not needed here: static service names are a reinstatement precondition only without Oracle Clusterware or Oracle Restart, and a RAC database runs under Clusterware.'
              : 'One of the reinstatement preconditions, where Clusterware or Oracle Restart is not doing it.'}
          />
        </Group>
      )}

      <Group title="Transport">
        <Choice
          name="LogXptMode"
          value={member.logXptMode}
          options={logXptOptions(doc)}
          onChange={(v) => setLogXptMode(id, v)}
          note={LOG_XPT_NOTE}
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
        /* A RAC member's instances are what the reader came to a cluster for:
           open until they shut it (remembered for the session). One instance
           is the ordinary case and stays folded. */
        defaultOpen={member.instances.length > 1}
        title={member.instances.length > 1 ? `Instances (RAC, ${member.instances.length})` : 'Instance'}
        hint={member.instances.map((inst) => inst.name).join(', ')}
      >
        {member.instances.map((inst, i) => (
          <div class="rr-dest lrow is-inst" key={`inst-${i}`}>
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
        <div class="rr-line lrow is-acts">
          <Action label="+ Instance" onClick={() => addInstance(id)} />
        </div>
        {db !== null && isRac(member) && db.role !== 'snapshot' ? (
          <>
            <Pick
              name="PreferredApplyInstance"
              value={db.preferredApplyInstance ?? ''}
              options={[
                { value: '', label: 'empty — the broker chooses' },
                ...member.instances.map((inst) => ({ value: inst.name, label: inst.name })),
                ...(db.preferredApplyInstance !== undefined
                  && !member.instances.some((inst) => inst.name === db.preferredApplyInstance)
                  ? [{ value: db.preferredApplyInstance, label: `${db.preferredApplyInstance} (not an instance)` }]
                  : []),
              ]}
              onChange={(v) => patchDatabase(
                id, `Set PreferredApplyInstance on ${id as string}`,
                (m) => {
                  const { preferredApplyInstance: _drop, ...rest } = m;
                  return v === '' ? rest : { ...rest, preferredApplyInstance: v };
                },
              )}
              note={isPrimary
                ? 'Only used while the database is a standby: set on a primary it names the apply instance for after a switchover.'
                : 'The instance apply starts on, and the one it returns to after the apply instance fails, when that one is running. Empty, the broker picks at random; this page draws the first running instance.'}
            />
            <Num
              name="ApplyInstanceTimeout"
              bound="applyInstanceTimeoutSeconds"
              kind="number"
              value={db.applyInstanceTimeoutSeconds ?? 0}
              onChange={(v) => patchDatabase(
                id, `Set ApplyInstanceTimeout on ${id as string}`,
                (m) => {
                  const { applyInstanceTimeoutSeconds: _drop, ...rest } = m;
                  return v > 0 ? { ...rest, applyInstanceTimeoutSeconds: v } : rest;
                },
              )}
              note="How long the broker waits after detecting that the apply instance failed before it moves apply. Broker default 0: immediate apply instance failover."
            />
            {db.role === 'physical' || db.role === 'primary' ? (
              <Pick
                name="ApplyInstances"
                value={db.applyInstances === undefined ? '0' : String(db.applyInstances)}
                options={[
                  { value: '0', label: '0 — one instance (the default)' },
                  ...Array.from({ length: member.instances.length - 1 }, (_, k) => ({
                    value: String(k + 2), label: `${k + 2} — up to ${k + 2} instances`,
                  })),
                  { value: 'ALL', label: 'ALL — every running instance' },
                ]}
                onChange={(v) => patchDatabase(
                  id, `Set ApplyInstances on ${id as string}`,
                  (m) => {
                    const { applyInstances: _drop, ...rest } = m;
                    return v === '0' ? rest : { ...rest, applyInstances: v === 'ALL' ? 'ALL' : Number(v) };
                  },
                )}
                note="Physical standby only. Above 1, Redo Apply runs on several instances with one of them the coordinator, the broker's apply instance; the database picks which, and this page draws the first running ones. What happens when an instance other than the coordinator fails is not documented: this page keeps apply going on the rest."
              />
            ) : null}
          </>
        ) : null}
        <Note>
          More than one instance is RAC. A RAC primary stays available while at least one
          instance still ships redo, so losing some of them leaves it degraded rather than
          down. A RAC standby runs apply on exactly one instance, the apply instance; if it
          fails, the broker moves apply to another running instance. Which instance ships
          which redo thread is not modelled, and a failed apply instance is detected at once.
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
            <div class="dest sub" key={to.id as string}>
              <div class="sub-hd">
                <span class="sub-t mono">{to.id as string}</span>
                <span class="rr-spacer" />
                <span class={xpt === null ? 'tag t-sl' : 'tag t-sl mono'}>{xpt ?? 'not resolved'}</span>
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
                  : 'Default 30 s, 8 to 10 s recommended. The broker property page gives 0 to 1200; the underlying NET_TIMEOUT attribute of LOG_ARCHIVE_DEST_n gives 1 to 1200 -- Oracle does not reconcile the two. It bounds how long LGWR waits for the standby acknowledgement; it is never a failover clock.'}
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
                note={doc.config.edition === '26ai'
                  ? 'Consecutive failures, counting the initial one; default 0 (continuous retries) outside a RedoRoutes group, 1 inside one. MaxFailure = 1 makes no reactivation attempt at all; above 1, attempts continue until the count is reached, then stop. Whether a successful reopen resets the count is not documented.'
                  : 'Consecutive attempts to reestablish the destination at log switches; default 0 (unlimited) outside a RedoRoutes group, 1 inside one. At the limit the destination is disabled with no further access until it is manually reenabled -- healing the network does not bring it back. Whether a successful reopen resets the count is not documented.'}
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
    </>
  );
}
