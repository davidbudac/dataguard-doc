/**
 * What the three ported models do once the deployment stops being 1+1+1:
 * an ADDRESS_LIST of three, a commit with a far sync leg and with two
 * synchronous ones, and a destination inside a priority group.
 *
 * The published numbers are pinned in `legacy-models.test.ts`; this file pins
 * the generalisations, and the wording rules that go with them.
 */

import { describe, expect, it } from 'vitest';
import { classicTopology } from '../src/engine/compat/classic';
import { simulate } from '../src/engine/sim/simulate';
import { computeApp } from '../src/engine/models/app';
import { computeCommit } from '../src/engine/models/commit';
import { computeReopen, outageFromTrace, reopenInputFrom } from '../src/engine/models/reopen';
import { buildTns } from '../src/engine/generate/tnsnames';
import { buildJdbc } from '../src/engine/generate/jdbc';
import { lineText, renderPlain } from '../src/engine/generate/lines';
import type { GeneratedFile, Line } from '../src/engine/generate/lines';
import { claimWellFormed } from '../src/engine/types/claims';
import type { Claim } from '../src/engine/types/claims';
import { hostId, memberId } from '../src/engine/ids';
import type { TimedEvent } from '../src/engine/types/events';
import { multiTargetDoc } from './topologies';

const firstLine = (f: GeneratedFile): Line => f.lines[0] as Line;

/* ---------------- computeApp over N addresses ---------------- */

describe('computeApp: an ADDRESS_LIST of three', () => {
  const threeAddress = (events: TimedEvent[]) => {
    const doc = multiTargetDoc();
    doc.client.addresses = [
      { host: hostId('dc1-prm01'), port: 1521 },
      { host: hostId('dc2-sby01'), port: 1521 },
      { host: hostId('dc3-sby02'), port: 1521 },
    ];
    doc.events = events;
    const trace = simulate(doc, events);
    return { doc, trace, app: computeApp(doc.client, trace, doc) };
  };

  it('charges every address in the list, in the order the descriptor lists them', () => {
    const { app } = threeAddress([{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(app.addresses.map((a) => a.kind)).toEqual(['timeout', 'refuse', 'refuse']);
    expect(app.passCost).toBeCloseTo(60.4, 9);      // 60 + 0.2 + 0.2
    expect(app.worst).toBeCloseTo(60.4, 9);         // RETRY_COUNT 0: one traversal
    expect(app.d1).toBe(60);
    /* The first candidate is promoted, so the connection lands on address 2 --
       the broker walks the candidate list in ORDER, and this is the order. */
    const last = app.attempts[app.attempts.length - 1];
    expect(last?.ok).toBe(true);
    expect(last?.dials[last.dials.length - 1]?.index).toBe(1);
  });

  it('a dead data centre in the middle of the list costs a second timeout', () => {
    /* The data centre goes first and the primary ten seconds later: the
       broker changes the target to sby02 while the primary is there to change
       it. Losing the two at the same instant promotes nobody (fact check
       SIM-05), and then there is no service to connect to. */
    const { app } = threeAddress([
      { at: 0, kind: 'site.down', site: 'dc2' as never },
      { at: 10, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(app.addresses.map((a) => a.kind)).toEqual(['timeout', 'timeout', 'refuse']);
    expect(app.passCost).toBeCloseTo(120.2, 9);
    const last = app.attempts[app.attempts.length - 1];
    /* sby02 is the second candidate, and the target by the time of the failure. */
    expect(last?.dials[last.dials.length - 1]?.index).toBe(2);
    /* The ladder starts when the primary stops answering, at 10 s. */
    expect(app.tConn).toBeCloseTo(130.3, 9);
  });

  it('every claim it carries is well formed, and the model ones say so', () => {
    const { app } = threeAddress([{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    const claims: Claim<string>[] = Object.values(app.claims).filter(Boolean) as Claim<string>[];
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(claimWellFormed(c), c.value).toBe(true);
    expect(app.claims.vantage.basis).toBe('model');
    expect(app.claims.nominal.basis).toBe('model');
    expect(app.claims.refusal.cite).toContain('ORA.12514');
  });

  it('LOAD_BALANCE on is a labelled model, because the dial order stops being the list order', () => {
    const doc = classicTopology({ scenario: 'crash', transportLag: 0 });
    doc.client.loadBalance = true;
    const trace = simulate(doc, doc.events);
    const app = computeApp(doc.client, trace, doc);
    expect(app.claims.loadBalance?.basis).toBe('model');
    expect(app.claims.loadBalance?.note).toMatch(/random order/);
  });
});

/* ---------------- computeCommit over N legs ---------------- */

describe('computeCommit: more than one leg', () => {
  it('the far sync hop terminates the commit', () => {
    const cm = computeCommit({
      mode: 'MAXAVAILABILITY', localWriteMs: 2,
      legs: [
        { to: memberId('fs1'), kind: 'farsync', xpt: 'SYNC', rttMs: 2, destWriteMs: 1 },
        { to: memberId('sby01'), kind: 'database', xpt: 'ASYNC', rttMs: 40, destWriteMs: 2 },
      ],
    });
    /* SYNC into the far sync: one way, its redo log write, one way back. The
       ASYNC hop onward to the terminal standby is not part of the commit. */
    expect(cm.legs[0]?.terminatesCommit).toBe(true);
    expect(cm.ackPathMs).toBe(3);
    expect(cm.commitMs).toBe(3);
    expect(cm.legs[1]?.waits).toBe(false);
    expect(cm.claims.farSync?.basis).toBe('documented');
    /* The far sync is not a database, so ASYNC to the terminal standby behind
       it is not a maximum availability mode conflict. */
    expect(cm.modeConflict).toBe(false);
  });

  it('two synchronous legs: waiting for all of them is the model, first-ack the toggle', () => {
    const legs = [
      { to: memberId('sby01'), kind: 'database' as const, xpt: 'SYNC' as const, rttMs: 4, destWriteMs: 1 },
      { to: memberId('sby02'), kind: 'database' as const, xpt: 'SYNC' as const, rttMs: 20, destWriteMs: 1 },
    ];
    const all = computeCommit({ mode: 'MAXAVAILABILITY', localWriteMs: 2, legs });
    const first = computeCommit({ mode: 'MAXAVAILABILITY', localWriteMs: 2, legs, waitPolicy: 'first-ack' });
    expect(all.commitMs).toBe(21);
    expect(first.commitMs).toBe(5);
    expect(all.claims.multiSync?.basis).toBe('model');
    expect(first.claims.multiSync?.basis).toBe('model');
    /* One leg is never a multi-SYNC question, so the label does not appear. */
    const one = computeCommit({ mode: 'MAXAVAILABILITY', localWriteMs: 2, legs: [legs[0] as typeof legs[0]] });
    expect(one.claims.multiSync).toBe(undefined);
  });
});

/* ---------------- computeReopen per destination ---------------- */

describe('computeReopen: one destination at a time', () => {
  it('a destination in a priority group is not disabled at MaxFailure', () => {
    const base = { reopenSeconds: 300, maxFailure: 1, outageSeconds: 1800, redoRateMBs: 5,
      mode: 'MAXAVAILABILITY' as const, lagLimitSeconds: 30 };
    const plain = computeReopen(base);
    expect(plain.disabledAt).toBe(300);
    expect(plain.reconnectAt).toBe(null);
    /* The documented 12.2+ exception: it re-enters service when it is found
       accessible, so the ladder runs to the end of the outage. */
    const grouped = computeReopen({ ...base, inPriorityGroup: true });
    expect(grouped.disabledAt).toBe(null);
    expect(grouped.reentersWhenAccessible).toBe(true);
    expect(grouped.reconnectAt).toBe(1800);
    expect(grouped.claims.priorityGroup?.basis).toBe('documented');
    expect(grouped.claims.priorityGroup?.cite).toContain('DEST.GROUP_PRIORITY_REENTER');
  });

  it('reads the destination attributes off the member, and the outage off the trace', () => {
    const doc = classicTopology({ scenario: 'dc2down', reopen: 60, maxFailure: 3, transportLag: 0 });
    const trace = simulate(doc, doc.events);
    const input = reopenInputFrom(doc, memberId('prm01'), memberId('sby01'), { outageSeconds: 600 });
    expect(input.reopenSeconds).toBe(60);
    expect(input.maxFailure).toBe(3);
    expect(input.mode).toBe('MAXAVAILABILITY');
    expect(input.fsfoEnabled).toBe(true);
    /* The standby's site is down for good in this scenario, so the trace has
       no outage to hand over -- the panel's own slider supplies one. */
    expect(outageFromTrace(trace, memberId('sby01'))).toBe(null);
    const rp = computeReopen(input);
    expect(rp.disabledAt).toBe(180);              // three retries at 60 s
  });

  it('with no observer deployed nothing is armed', () => {
    const doc = classicTopology({ observerLoc: 'none', transportLag: 0 });
    const input = reopenInputFrom(doc, memberId('prm01'), memberId('sby01'), { outageSeconds: 600 });
    expect(input.fsfoEnabled).toBe(false);
  });
});

/* ---------------- the two connect-string cards ---------------- */

describe('tnsnames.ora and the JDBC thin URL', () => {
  const doc = () => classicTopology({ transportLag: 0 });

  it('the default descriptor writes no defaults into the string', () => {
    const file = buildTns(doc());
    expect(renderPlain(file)).toBe([
      'app_svc =',
      ' (DESCRIPTION =',
      '   (ADDRESS_LIST = (FAILOVER = on)',
      '     (ADDRESS = (PROTOCOL = tcp)(HOST = dc1-prm01)(PORT = 1521))',
      '     (ADDRESS = (PROTOCOL = tcp)(HOST = dc2-sby01)(PORT = 1521)))',
      '   (CONNECT_DATA = (SERVICE_NAME = app_svc)))',
      '',
      '# not in the string, defaults apply:',
      '#   TRANSPORT_CONNECT_TIMEOUT (60 s default) - CONNECT_TIMEOUT (no cap)',
      '#   RETRY_COUNT (0 -- no retries) - RETRY_DELAY (immediate)',
    ].join('\n'));
  });

  it('a tuned descriptor spells the four parameters and highlights them', () => {
    const d = classicTopology({ tct: 3, ct: 90, rc: 30, rd: 3, transportLag: 0 });
    const text = renderPlain(buildTns(d));
    expect(text).toContain('(TRANSPORT_CONNECT_TIMEOUT = 3)(CONNECT_TIMEOUT = 90)');
    expect(text).toContain('(RETRY_COUNT = 30)(RETRY_DELAY = 3)');
    expect(text).not.toContain('not in the string');
    const set = buildTns(d).lines.filter((l) => l.spans.some((s) => s.highlight));
    expect(set.length).toBe(2);                    // two tokens to a line
  });

  it('the ADDRESS_LIST covers every service-publishing host', () => {
    const d = multiTargetDoc();
    d.client.addresses = [];
    const text = renderPlain(buildTns(d));
    expect(text).toContain('(HOST = dc1-prm01)');
    expect(text).toContain('(HOST = dc2-sby01)');
    expect(text).toContain('(HOST = dc3-sby02)');
    /* The observer host publishes nothing. */
    expect(text).not.toContain('dc3-obs01');
  });

  it('the thin URL always spells the transport timeout, with its sec suffix', () => {
    const url = lineText(firstLine(buildJdbc(doc())));
    expect(url).toContain('(TRANSPORT_CONNECT_TIMEOUT=60sec)');
    expect(url.startsWith('jdbc:oracle:thin:@(DESCRIPTION=')).toBe(true);
    const tuned = buildJdbc(classicTopology({ tct: 3, ct: 90, rc: 30, rd: 3, transportLag: 0 }));
    const tunedUrl = lineText(firstLine(tuned));
    expect(tunedUrl).toContain('(TRANSPORT_CONNECT_TIMEOUT=3sec)(CONNECT_TIMEOUT=90sec)(RETRY_COUNT=30)(RETRY_DELAY=3)');
    /* The sec note names neither driver release: the pages do not state one. */
    const text = renderPlain(tuned);
    expect(text).toContain('sec written out on purpose');
    expect(text).not.toMatch(/1[89]c driver changed|21c|23ai/);
  });

  it('spells RETRY_DELAY=0 out under 26ai, where the driver default is 1 second', () => {
    const v19 = buildJdbc(classicTopology({ rd: 0, transportLag: 0 }));
    expect(renderPlain(v19)).not.toContain('RETRY_DELAY');

    const v26 = buildJdbc(classicTopology({ version: '26ai', rd: 0, transportLag: 0 }));
    const text = renderPlain(v26);
    expect(text).toContain('(RETRY_DELAY=0)');
    expect(text).toContain('starting in 26ai the driver default is 1 second');

    const v26tuned = buildJdbc(classicTopology({ version: '26ai', rd: 3, transportLag: 0 }));
    expect(renderPlain(v26tuned)).toContain('(RETRY_DELAY=3)');
  });

  it('the lead comment is the caller choice', () => {
    expect(buildJdbc(doc(), { lead: true }).lines[0]?.kind).toBe('comment');
    expect(buildJdbc(doc()).lines[0]?.kind).toBe('cmd');
  });

  it('ConfigurationWideServiceName is offered as a documented alternative', () => {
    const d = doc();
    d.config.configurationWideServiceName = 'prm01_CFG';
    const file = buildTns(d);
    const n = file.lines.find((l) => l.kind === 'note');
    expect(n?.basis).toBe('documented');
    expect(n?.cite).toContain('CFG.WIDE_SERVICE_NAME');
    expect(lineText(n as Line)).toContain('does not change after a role transition');
  });
});
