/**
 * The configuration itself: protection mode, fast-start failover, and the
 * environment constants the drawings are scaled by.
 *
 * Everything here is a broker property spelled the way DGMGRL spells it, and
 * every restriction that greys a control is a documented one taken from the
 * WHY table -- never a guess about what "ought" to be illegal. Two of them
 * are edition gates rather than prohibitions: `PreferredObserverHosts` is
 * later-edition behaviour, and `FastStartFailoverLagLimit` is a maximum
 * performance property under 19c that 26ai also gives a maximum availability
 * role, where its broker default is 0 -- zero data loss.
 */

import { useLayoutEffect } from 'preact/hooks';
import { BOUNDS } from '@/engine';
import type { FsfoConfig, MemberId, RoutePriority, TopologyDoc } from '@/engine';
import { hostId, isDatabase, lagLimitIsSet, lagLimitOf } from '@/engine';
import { errors } from '@/state/derived';
import { Fact } from '../common/Chip';
import { Action, Check, Choice, Fold, Note, Num, Pick, Text } from './controls';
import { FieldNote } from '../common/Field';
import { patchConfig, patchEnvironment, patchFsfo } from './edits';
import { revealForFlagged, sectionsWithErrors } from './sections';
import { gateOff, off, ON, WHY } from './why';

export interface ConfigFormProps {
  doc: TopologyDoc;
}

const PRIORITIES: RoutePriority[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function ConfigForm({ doc }: ConfigFormProps) {
  const c = doc.config;
  const f = c.fsfo;
  const ed = c.edition;
  const perf = c.protectionMode === 'MAXPERFORMANCE';
  const avail = c.protectionMode === 'MAXAVAILABILITY';
  const pingSet = f.pingIntervalMs !== null && f.pingRetry !== null;
  /* The limit in force: as set, or the broker default for the edition and
     mode being read until somebody sets it. Editing it sets it. */
  const lagLimit = lagLimitOf(doc);
  const fsfoOn = f.state !== 'disabled';
  const databases = doc.members.filter(isDatabase);
  const targetList = f.target.kind === 'list' ? f.target.members : [];

  /* 19c: a maximum performance property, and 19c disagrees with itself about
     whether it reaches maximum availability at all -- this page follows the
     observed 19.27 behaviour (not evaluated there) over the chapter's "must
     be zero" sentence. 26ai: maximum availability has the role too, where 0
     is the broker default and means zero data loss; that role is a 21c
     feature, not a 26ai one. */
  const lagLimitOff = perf
    ? ON
    : ((ed === '26ai' && avail) ? ON : off(ed === '26ai' ? WHY.lagTypeMode : WHY.lagLimitMaxAvail19c));

  const setTarget = (members: MemberId[]): void =>
    patchFsfo(
      `Set FastStartFailoverTarget to ${members.join(', ') || 'nothing'}`,
      (x): FsfoConfig => ({ ...x, target: { kind: 'list', members } }),
    );

  const move = (i: number, by: number): void => {
    const next = [...targetList];
    const j = i + by;
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setTarget(next);
  };

  const detectSeconds = pingSet && f.pingIntervalMs !== null && f.pingRetry !== null
    ? (f.pingIntervalMs * (f.pingRetry + 1)) / 1000
    : null;

  /* A fold that hid the very property `validate()` is complaining about would
     be the page hiding its own answer, so an error opens its section. Once,
     when the error appears: the reader may fold it away again. */
  const flagged = sectionsWithErrors(errors.value);
  const flaggedKey = flagged.join('|');
  /* A layout effect rather than an ordinary one: the section has to be open in
     the same frame the error arrives in, and preact defers `useEffect` until
     after paint -- which is a fold that opens itself a beat late. `revealFor-
     Flagged` rather than `revealSections` because this effect also runs on
     every mount, and this form unmounts on every card selection: without it, a
     fold the reader closed re-opened the next time they cleared the selection. */
  useLayoutEffect(() => { revealForFlagged(flaggedKey, flagged); }, [flaggedKey]);

  const candidates = c.primaryDatabaseCandidates ?? [];
  const preferred = f.preferredObserverHosts ?? [];
  const targetWord = f.target.kind === 'ANY' ? 'ANY' : (targetList.join(', ') || 'not set');

  return (
    <>
      <Fold id="Configuration" title="Configuration" hint={c.protectionMode}>
        <Text
          name="Name" prose
          value={c.name}
          onCommit={(v) => patchConfig('Rename the configuration', (x) => ({ ...x, name: v.trim() || x.name }))}
        />
        <Choice
          name="Protection mode" prose
          value={c.protectionMode}
          options={[
            { value: 'MAXPROTECTION', label: 'MAXPROTECTION' },
            { value: 'MAXAVAILABILITY', label: 'MAXAVAILABILITY' },
            { value: 'MAXPERFORMANCE', label: 'MAXPERFORMANCE' },
          ]}
          onChange={(v) => patchConfig(`Set the protection mode to ${v}`, (x) => ({ ...x, protectionMode: v }))}
          note="Broker table 4-2 lists the transports each mode takes: SYNC under maximum protection, SYNC or FASTSYNC under maximum availability, and ASYNC as the only mode listed for maximum performance."
        />
        <Choice
          name="BystandersFollowRoleChange"
          value={c.bystandersFollowRoleChange}
          options={[{ value: 'ALL', label: 'ALL' }, { value: 'NONE', label: 'NONE' }]}
          onChange={(v) => patchConfig(
            `Set BystandersFollowRoleChange to ${v}`, (x) => ({ ...x, bystandersFollowRoleChange: v }),
          )}
          note="Whether the standbys that are not the failover target follow the role change. Broker default ALL."
        />
        <Text
          name="ConfigurationWideServiceName"
          value={c.configurationWideServiceName ?? ''}
          placeholder={`not set (default ${c.name}_CFG)`}
          onCommit={(v) => patchConfig('Set ConfigurationWideServiceName', (x) => {
            const next = { ...x };
            if (v.trim() === '') delete next.configurationWideServiceName;
            else next.configurationWideServiceName = v.trim();
            return next;
          })}
          note="One name for the configuration, as an alternative to listing every address. The default is primarydbname_CFG, documented in 12.2, 18c, 19c and 26ai alike -- never a later edition -- and does not change after a role transition."
        />
        <Note>
          Default primarydbname_CFG.
          <Fact basis="documented" id="CFG.WIDE_SERVICE_NAME" />
        </Note>
      </Fold>

      <Fold
        id="PrimaryDatabaseCandidates"
        title="PrimaryDatabaseCandidates"
        hint={candidates.length === 0 ? 'empty' : candidates.join(', ')}
      >
        <div class="opt-list">
        {databases.map((m) => {
          const list = candidates;
          const on = list.includes(m.id);
          return (
            <label class="opt" key={m.id as string}>
              <input
                type="checkbox"
                checked={on}
                disabled={ed === '19c'}
                onChange={() => patchConfig(
                  `${on ? 'Remove' : 'Add'} ${m.id as string} in PrimaryDatabaseCandidates`,
                  (x) => {
                    const cur = x.primaryDatabaseCandidates ?? [];
                    const next = on ? cur.filter((y) => y !== m.id) : [...cur, m.id];
                    const out = { ...x };
                    if (next.length === 0) delete out.primaryDatabaseCandidates;
                    else out.primaryDatabaseCandidates = next;
                    return out;
                  },
                )}
              />
              <span class="mono">{m.id as string}</span>
            </label>
          );
        })}
        </div>
        {ed === '19c' ? (
          <Note>
            {WHY.docLater26aiObservedIn1927}
          </Note>
        ) : (
          <Note>
            A fast-start-failover-disabled fence: while fast-start failover is disabled it
            restricts <span class="mono">SWITCHOVER</span> and
            <span class="mono"> FAILOVER</span> to the databases it lists and refuses
            anything else with <span class="mono">ORA-16529</span>. Once fast-start failover
            is enabled it adds nothing new, because
            <span class="mono"> FastStartFailoverTarget</span> already governs the target.
            The default is empty, which restricts nothing, and the broker adds the current
            primary itself if the list omits it.
          </Note>
        )}
      </Fold>

      <Fold
        id="Fast-start failover"
        title="Fast-start failover"
        hint={`${f.state === 'observe-only' ? 'OBSERVE ONLY' : f.state.toUpperCase()} → ${targetWord}`}
      >
        <Choice
          name="FAST_START FAILOVER"
          value={f.state}
          options={[
            { value: 'disabled', label: 'DISABLED' },
            { value: 'enabled', label: 'ENABLED' },
            { value: 'observe-only', label: 'OBSERVE ONLY' },
          ]}
          onChange={(v) => patchFsfo(
            `Set fast-start failover to ${v}`, (x): FsfoConfig => ({ ...x, state: v }),
          )}
          note={f.state === 'observe-only'
            ? 'ENABLE FAST_START FAILOVER OBSERVE ONLY: the observer watches, records what it would have done, and never fails over.'
            : f.state === 'disabled'
              ? 'Disabled is not the same as unobserved. With fast-start failover disabled a manual FAILOVER TO is the only thing that promotes a standby, and it needs no observer.'
              : "Failover needs both the observer and the target standby to have lost the primary for the threshold, plus the target standby's readiness check. This page draws ObserverOverride at FALSE, the broker default."}
        />

        {/* The target list is the one property here that is a list, so it is
            the one field drawn by hand: its name and reading on the first
            line, a row per target under it (the order the broker walks), then
            the databases that could be added, and the switch to ANY last. */}
        <div class="field is-stack">
          <div class="field-hd">
            <span class="field-name">FastStartFailoverTarget</span>
            <span class="field-val">{targetWord}</span>
          </div>
          <div class="field-ctl">
            {f.target.kind === 'ANY' ? null : (
              <>
                {targetList.map((id, i) => (
                  <div class="rr-dest lrow" key={id as string}>
                    <span class="lrow-k mono">{i + 1}. {id as string}</span>
                    {/* Only the moves that exist: the first target has no
                        "Up", exactly as the Break rail's first event has no
                        "Earlier". */}
                    {i === 0 ? null : <Action label="Up" onClick={() => move(i, -1)} />}
                    {i === targetList.length - 1
                      ? null
                      : <Action label="Down" onClick={() => move(i, 1)} />}
                    <Action
                      label="Remove"
                      onClick={() => setTarget(targetList.filter((x) => x !== id))}
                    />
                  </div>
                ))}
                {databases
                  .filter((m) => !targetList.includes(m.id))
                  .map((m) => (
                    <div class="rr-dest lrow" key={`add-${m.id as string}`}>
                      <span class="lrow-k mono">{m.id as string}</span>
                      <Action
                        label="Add as a target"
                        enabled={m.role === 'primary'
                          ? off(WHY.primaryNotTarget)
                          : m.role === 'snapshot' ? off(WHY.snapshotNotTarget) : ON}
                        onClick={() => setTarget([...targetList, m.id])}
                      />
                    </div>
                  ))}
                {doc.members.filter((m) => m.kind === 'farsync').map((m) => (
                  <div class="rr-dest lrow" key={`fs-${m.id as string}`}>
                    <span class="lrow-k mono">{m.id as string}</span>
                    <Action label="Add as a target" enabled={off(WHY.farSyncNotTarget)} onClick={() => undefined} />
                  </div>
                ))}
              </>
            )}
            <div class="rr-line lrow is-acts">
              <Action
                label={f.target.kind === 'ANY' ? 'Name the targets' : 'Set to ANY'}
                onClick={() => patchFsfo(
                  f.target.kind === 'ANY' ? 'Name the failover targets' : 'Set FastStartFailoverTarget to ANY',
                  (x): FsfoConfig => ({
                    ...x,
                    target: x.target.kind === 'ANY' ? { kind: 'list', members: [] } : { kind: 'ANY' },
                  }),
                )}
              />
            </div>
          </div>
          {f.target.kind === 'ANY' ? (
            <FieldNote>
              Every valid standby is a candidate. With more than one standby the property
              must be set explicitly for fast-start failover to be enabled.
            </FieldNote>
          ) : (
            <FieldNote>
              The order is the order the broker walks: it takes the candidates in the
              order the property lists them, never "the first viable one".
              <Fact basis="model" id="FSFO.TARGET_SELECTION" />
            </FieldNote>
          )}
        </div>

        <Num
          name="FastStartFailoverThreshold"
          bound="thresholdSeconds"
          value={f.thresholdSeconds}
          coalesce="fsfo:threshold"
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverThreshold to ${v} s`,
            (x): FsfoConfig => ({ ...x, thresholdSeconds: v }), 'fsfo:threshold',
          )}
          note="Default 30 s, minimum 6 s. The clock starts when the observer first loses its connection to the primary, and the isolated primary's own stall clock always uses it."
        />

        <Num
          name="FastStartFailoverLagLimit"
          bound="lagLimitSeconds"
          value={lagLimit}
          coalesce="fsfo:laglimit"
          enabled={lagLimitOff}
          warn={lagLimit > f.thresholdSeconds}
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverLagLimit to ${v} s`,
            (x): FsfoConfig => ({ ...x, lagLimitSeconds: v, lagLimitSet: true }), 'fsfo:laglimit',
          )}
          note={(lagLimitIsSet(f) ? '' : 'Not set: the broker default for this edition and mode applies. ')
            + (lagLimit > f.thresholdSeconds
            ? 'Oracle recommends the lag limit at or below the threshold: past it the old primary can keep committing after fast-start failover is initiated, briefly risking two primaries.'
            : ed === '26ai' && avail
              ? '26ai gives maximum availability a lag limit too, with a broker default of 0 -- the standby must have received everything and the failover is zero-loss. Any non-zero value, minimum 5 s, makes it bounded-loss. The role arrived in 21c; 26ai\'s own contribution is the per-mode default.'
              : ed === '19c' && avail
                ? 'Under 19c this control is greyed because the property page and the fast-start failover chapter disagree about whether it reaches maximum availability at all -- see the why-pill. Default 30 s, minimum 5 s.'
                : 'Default 30 s, minimum 5 s. Failover is permitted while the gated lag stays within it.')}
        />

        <Choice
          name="FastStartFailoverLagType"
          value={f.lagType}
          options={[{ value: 'APPLY', label: 'APPLY' }, { value: 'TRANSPORT', label: 'TRANSPORT' }]}
          enabled={ed === '19c' ? off(WHY.docLater26aiObservedIn1927) : gateOff(!perf, WHY.lagTypeMode)}
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverLagType to ${v}`, (x): FsfoConfig => ({ ...x, lagType: v }),
          )}
          note={ed === '19c'
            ? 'Documented from 26ai; absent from the 19c and 21c properties references. A live 19.27 system carries it regardless (SHOW FAST_START FAILOVER prints Lag Type:) -- an observation, never documentation.'
            : 'Under TRANSPORT the gated quantity is the transport lag, clamped to the apply lag; terminal recovery still pays the apply lag.'}
        />

        <Num
          name="FastStartFailoverLagGraceTime"
          bound="lagGraceTimeSeconds"
          value={f.lagGraceTimeSeconds}
          coalesce="fsfo:laggrace"
          enabled={ed === '19c'
            ? off(WHY.docLater26aiObservedIn1927)
            : !fsfoOn
              ? off(WHY.lagGraceNoFsfo)
              : gateOff(!perf, WHY.lagGraceMode)}
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverLagGraceTime to ${v} s`,
            (x): FsfoConfig => ({ ...x, lagGraceTimeSeconds: v }), 'fsfo:laggrace',
          )}
          note={ed === '19c'
            ? 'Documented from 26ai; absent from the 19c and 21c properties references. A live 19.27 system carries it regardless (SHOW FAST_START FAILOVER prints Lag Grace Time:) -- an observation, never documentation.'
            : 'The permission to keep committing while the lag is over the limit is granted by the observer or the target standby, and the property is defined only while fast-start failover is enabled.'}
        />

        <Check
          name="ObserverPingInterval / ObserverPingRetry"
          label="Both properties are explicitly set"
          checked={pingSet}
          enabled={ed === '19c' ? off(WHY.pingPropsNotIn19c) : ON}
          onChange={(v) => patchFsfo(
            v ? 'Set the ObserverPing properties' : 'Leave the ObserverPing properties unset',
            (x): FsfoConfig => ({
              ...x,
              pingIntervalMs: v ? BOUNDS.pingIntervalMs.default : null,
              pingRetry: v ? BOUNDS.pingRetry.default : null,
            }),
          )}
          note={ed === '19c'
            ? 'Neither property exists in 19c: absent from the 12.2, 18c and 19c property pages and from a live 19.27 system. First documented in 21c.'
            : "When both are set, the threshold is ignored for the observer's detection. That much is documented; the arithmetic below is not."}
        />
        <Num
          name="ObserverPingInterval"
          bound="pingIntervalMs"
          value={f.pingIntervalMs ?? BOUNDS.pingIntervalMs.default}
          coalesce="fsfo:pingint"
          enabled={ed === '19c' ? off(WHY.pingPropsNotIn19c) : pingSet ? ON : off(WHY.pingUnset)}
          onChange={(v) => patchFsfo(
            `Set ObserverPingInterval to ${v} ms`,
            (x): FsfoConfig => ({ ...x, pingIntervalMs: v }), 'fsfo:pingint',
          )}
        />
        <Num
          name="ObserverPingRetry"
          bound="pingRetry"
          kind="number"
          value={f.pingRetry ?? BOUNDS.pingRetry.default}
          enabled={ed === '19c' ? off(WHY.pingPropsNotIn19c) : pingSet ? ON : off(WHY.pingUnset)}
          onChange={(v) => patchFsfo(
            `Set ObserverPingRetry to ${v}`, (x): FsfoConfig => ({ ...x, pingRetry: v }),
          )}
          note={detectSeconds === null
            ? undefined
            : `The documentation says only that detection can be reduced to nearly one second. The first failed ping plus its retries reads as ${detectSeconds.toFixed(1)} s here.`}
        />
        {detectSeconds === null ? null : (
          <Note>
            Detection <span class="mono">= ObserverPingInterval &times; (ObserverPingRetry + 1)</span>
            <Fact basis="model" id="FSFO.PING_ARITHMETIC" />
          </Note>
        )}

        <Check
          name="FastStartFailoverPmyShutdown"
          label="A stalled primary shuts itself down"
          checked={f.pmyShutdown}
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverPmyShutdown to ${v ? 'TRUE' : 'FALSE'}`,
            (x): FsfoConfig => ({ ...x, pmyShutdown: v }),
          )}
          note="Default TRUE: a primary stalled longer than the threshold, able to reach neither the observer nor the target standby, will shut down."
        />
        <Check
          name="FastStartFailoverAutoReinstate"
          label="Reinstate the old primary automatically"
          checked={f.autoReinstate}
          onChange={(v) => patchFsfo(
            `Set FastStartFailoverAutoReinstate to ${v ? 'TRUE' : 'FALSE'}`,
            (x): FsfoConfig => ({ ...x, autoReinstate: v }),
          )}
          note="Only after an observer-initiated failover caused by a primary crash or isolation, and only with Flashback Database on both databases, the former primary mounted, the master observer able to reach it, and static service names."
        />
      </Fold>

      <Fold
        id="PreferredObserverHosts"
        title="PreferredObserverHosts"
        hint={preferred.length === 0
          ? 'not set'
          : `${preferred.length} host${preferred.length === 1 ? '' : 's'}`}
      >
        {preferred.map((p, i) => (
          <div class="rr-dest lrow" key={`${p.host as string}-${i}`}>
            <span class="lrow-k mono">{p.host as string}</span>
            <select
              class="field-in is-short"
              aria-label={`Priority for ${p.host as string}`}
              value={String(p.priority)}
              onChange={(e) => {
                const n = Number((e.currentTarget as HTMLSelectElement).value);
                const pr = PRIORITIES.find((x) => x === n) ?? 8;
                patchFsfo(`Set the observer host priority for ${p.host as string}`, (x): FsfoConfig => ({
                  ...x,
                  preferredObserverHosts: (x.preferredObserverHosts ?? [])
                    .map((y, j) => (j === i ? { ...y, priority: pr } : y)),
                }));
              }}
            >
              {PRIORITIES.map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
            <Action
              label="Remove"
              onClick={() => patchFsfo(`Remove ${p.host as string} from PreferredObserverHosts`, (x): FsfoConfig => ({
                ...x,
                preferredObserverHosts: (x.preferredObserverHosts ?? []).filter((_, j) => j !== i),
              }))}
            />
          </div>
        ))}
        <Pick
          name="Add a host"
          prose
          value=""
          options={[
            { value: '', label: 'pick a host' },
            ...doc.hosts.map((h) => ({ value: h.id as string, label: h.name })),
          ]}
          onChange={(v) => {
            if (v === '') return;
            patchFsfo(`Add ${v} to PreferredObserverHosts`, (x): FsfoConfig => ({
              ...x,
              preferredObserverHosts: [
                ...(x.preferredObserverHosts ?? []),
                { host: hostId(v), priority: 8 },
              ],
            }));
          }}
        />
        <Note>
          Lower wins, 1 to 8, default 8. Property scope is Database. Documented since 12.2 --
          present in the 19c property pages and in a live 19.27 system, never a later edition.
          {ed === '26ai'
            ? ' Under 26ai the master observer is changed automatically to an observer running on a higher priority host.'
            : ' Under 19c a change does not affect the location of the master observer until the next role change; 26ai changes it automatically instead.'}
          <Fact basis="documented" id={ed === '26ai' ? 'OBS.PREFERRED_HOSTS_26AI' : 'OBS.PREFERRED_HOSTS'} />
        </Note>
      </Fold>

      <Fold
        id="Environment"
        title="Environment"
        hint={`${doc.environment.roleTransitionSeconds} s role transition · ${doc.environment.redoRateMBs} MB/s`}
      >
        <Num
          name="Role transition" prose
          bound="roleTransitionSeconds"
          value={doc.environment.roleTransitionSeconds}
          coalesce="env:role"
          onChange={(v) => patchEnvironment(
            `Set the role transition to ${v} s`, (e) => ({ ...e, roleTransitionSeconds: v }), 'env:role',
          )}
          note="Terminal recovery, the role change and the open are environment-dependent, not parameter-driven. This is the drawing's constant for them."
        />
        <Num
          name="Local redo write" prose
          bound="localWriteMs"
          value={doc.environment.localWriteMs}
          coalesce="env:lw"
          onChange={(v) => patchEnvironment(
            `Set the local redo write to ${v} ms`, (e) => ({ ...e, localWriteMs: v }), 'env:lw',
          )}
        />
        <Num
          name="Standby redo log write" prose
          bound="standbyWriteMs"
          value={doc.environment.standbyWriteMs}
          coalesce="env:sbw"
          onChange={(v) => patchEnvironment(
            `Set the standby redo log write to ${v} ms`, (e) => ({ ...e, standbyWriteMs: v }), 'env:sbw',
          )}
          note="What an AFFIRM standby pays before it acknowledges."
        />
        <Num
          name="Redo rate" prose
          bound="redoRateMBs"
          value={doc.environment.redoRateMBs}
          coalesce="env:rate"
          onChange={(v) => patchEnvironment(
            `Set the redo rate to ${v} MB/s`, (e) => ({ ...e, redoRateMBs: v }), 'env:rate',
          )}
        />
      </Fold>
    </>
  );
}
