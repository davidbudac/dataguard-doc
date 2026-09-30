/**
 * The application's point of view, as three lanes on the run's own axis.
 *
 * Pure: `computeApp`'s model in, bands out. The Configure panel draws the same
 * model on an axis of its own, from t = 0; this is the general form, for a run
 * whose events fall anywhere and whose application stands in a data centre
 * that can itself be lost. Where the wording exists on the published page it
 * is that wording -- the drawing is new, what it says about Oracle is not.
 *
 * Three lanes, top to bottom:
 *   `Service`           where the role-based service is published, and whether
 *                       the application can reach it there
 *   `Sessions`          what the sessions that were already connected see
 *   `New connections`   the connect string at work: the retry ladder
 *
 * Everything here is this page's model: the costs are nominal drawing
 * constants and the vantage is the card's place on the drawing (`AppModel.claims`).
 */

import { applicationClient, findApplication } from '@/engine';
import type { AnyState, AppModel, AppPublisher, AppSpan, Seconds, TopologyDoc } from '@/engine';
import { fmt } from './build';
import type { InkClass, PhaseClass } from './build';

export interface AppBand {
  a: Seconds;
  b: Seconds;
  phase: PhaseClass;
  ink: InkClass;
  /** Longest form first. */
  labels: string[];
  /** `up` while the application is being served, `down` while it is not. */
  state: AnyState;
}

export interface AppLane {
  key: 'service' | 'sessions' | 'connect';
  name: string;
  subs: string[];
  bands: AppBand[];
}

export interface AppMark {
  key: 'reconnect' | 'exhausted';
  t: Seconds;
  label: string;
  tone: 'f-vi' | 'f-rd';
}

export interface AppSection {
  lanes: AppLane[];
  /** The one-line reading over the three lanes. */
  note: string;
  tone: 'ink' | 'f-am' | 'f-rd';
  marks: AppMark[];
  /** What the numbers rest on, for the heading's tooltip. */
  basis: string;
}

/** How long in-flight calls are drawn erroring before the pool reads empty. */
const ERROR_BURST: Seconds = 1.5;

const HANGING = new Set<string>(['stalled', 'commit-hang']);

const TEAL = { phase: 'b-tl', ink: 'f-tl', state: 'up' } as const;
const AMBER = { phase: 'b-am', ink: 'f-am', state: 'down' } as const;
const HATCH = { phase: 'b-hatch', ink: 'f-rd', state: 'down' } as const;
const SLATE = { phase: 'b-sl', ink: 'f-sl', state: 'up' } as const;

const APP_DOWN = ['The application is down with its host', 'Application down', 'Down'];

/** "A", "A and B", "A, B and C". */
const joined = (names: string[]): string =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** The publishers the application reaches: with two or more, two databases serve at once. */
const reachedOf = (sp: { publishers: readonly AppPublisher[] }): AppPublisher[] =>
  sp.publishers.filter((p) => p.reached);

/** The gutter subtitle of the service lane; a long name is shortened to fit. */
function serviceSubs(service: string): string[] {
  const s = service.length > 12 ? `${service.slice(0, 10)}...` : service;
  return [`${s} · role-based`, s];
}

export function appLanes(ap: AppModel, doc: TopologyDoc, t0: Seconds, t1: Seconds): AppSection {
  /* The descriptor this application dials -- its own, else the shared one. */
  const application = ap.application === null ? undefined : findApplication(doc, ap.application.id);
  const client = application === undefined ? doc.client : applicationClient(doc, application);
  const service = client.serviceName;
  const nameOf = (id: string | null): string =>
    (id === null ? '' : doc.members.find((m) => (m.id as string) === id)?.name ?? id);
  const hostName = (id: string): string =>
    doc.hosts.find((h) => (h.id as string) === id)?.name ?? id;

  /* The spans, clipped to the axis, behind the steady state the pre-roll
     shows: a trace opens on its first event, so nothing in it is "before". */
  const opens = ap.spans[0]?.t0 ?? t1;
  const steadySpan = { ...ap.steady, t0, t1: opens, a: t0, b: Math.min(t1, opens) };
  const spans: (AppSpan & { a: Seconds; b: Seconds })[] = [
    steadySpan,
    ...ap.spans.map((s) => ({ ...s, a: Math.max(t0, s.t0), b: Math.min(t1, s.t1 ?? t1) })),
  ].filter((s) => s.b > s.a);

  const lanes: AppLane[] = [
    { key: 'service', name: 'Service', subs: serviceSubs(service), bands: [] },
    { key: 'sessions', name: 'Sessions', subs: ['the connection pool', 'the pool'], bands: [] },
    { key: 'connect', name: 'New connections', subs: ['the string at work', 'the string'], bands: [] },
  ];
  const [svc, pool, conn] = lanes as [AppLane, AppLane, AppLane];

  const push = (lane: AppLane, a: Seconds, b: Seconds, look: Omit<AppBand, 'a' | 'b' | 'labels'>, labels: string[]): void => {
    const x0 = Math.max(t0, a);
    const x1 = Math.min(t1, b);
    if (x1 <= x0) return;
    const prev = lane.bands[lane.bands.length - 1];
    if (prev && prev.phase === look.phase && prev.labels[0] === labels[0] && Math.abs(prev.b - x0) < 1e-9) {
      prev.b = x1;
      return;
    }
    lane.bands.push({ a: x0, b: x1, ...look, labels });
  };

  /* ---- lane 1: where the service is published ---- */
  const first = spans.find((s) => s.serving !== null)?.serving ?? null;
  for (const s of spans) {
    const reached = reachedOf(s);
    if (reached.length >= 2) {
      /* Two databases publish it at once: one band, both named. */
      const names = reached.map((p) => nameOf(p.member as string));
      const said = reached.map((p, i) => (HANGING.has(p.state ?? '') ? `a STALLED ${names[i]}` : names[i] as string));
      push(svc, s.a, s.b, TEAL, [
        `Published by ${joined(said)} at once`, `On ${joined(names)}`, names.join(' + '),
      ]);
    } else if (s.serving !== null) {
      const n = nameOf(s.serving as string);
      /* Another database publishes it too, where the application cannot reach it. */
      const beyond = s.publishers.filter((p) => !p.reached).map((p) => nameOf(p.member as string));
      const aside = beyond.length === 0 ? '' : ` — ${joined(beyond)} ${beyond.length === 1 ? 'publishes' : 'publish'} too, out of reach`;
      push(svc, s.a, s.b, TEAL, HANGING.has(s.servingState ?? '')
        ? [`Still published — on a STALLED ${n}${aside}`, 'Still published', 'Published']
        : s.serving === first
          ? [`Published by ${n}'s listener${aside}`, `On ${n}`, n]
          : [`Published by ${n} — started at role change${aside}`, `On ${n}`, n]);
    } else if (s.published !== null && s.appUp) {
      const n = nameOf(s.published as string);
      push(svc, s.a, s.b, AMBER,
        [`Published by ${n} — out of the application's reach`, 'Out of reach', '—']);
    } else if (s.published !== null) {
      const n = nameOf(s.published as string);
      push(svc, s.a, s.b, TEAL, [`Published by ${n}'s listener`, `On ${n}`, n]);
    } else {
      push(svc, s.a, s.b, HATCH, [`Nowhere — nothing publishes ${service}`, 'Nowhere', '—']);
    }
  }

  /* ---- what the run is, from the application's side ---- */
  const quiet = ap.noEvent && ap.noEventKind !== 'app-down';
  /* The instant the sessions lose their database, which is the model's: with
     two databases publishing it is not the first stretch with no service. A
     steady state that already has none is lost from the start of the axis. */
  const lost: Seconds | null = quiet ? null
    : (spans[0] === steadySpan && steadySpan.serving === null ? steadySpan.a : (ap.lostAt ?? ap.startAt));
  const end: Seconds | null = ap.tConn;
  /* A cut returns no errors: the sessions' own database is still there and
     publishing, and it is the packets that do not arrive. */
  const atLoss = lost === null ? undefined : spans.find((s) => s.a <= lost + 1e-9 && s.b > lost + 1e-9);
  const severed = atLoss !== undefined && atLoss.appUp && (ap.sessionsOn === null
    ? atLoss.published !== null
    : atLoss.publishers.some((p) => p.member === ap.sessionsOn && !p.reached));

  /* ---- lane 2: sessions that were already connected ---- */
  for (const s of spans) {
    const before = lost === null || s.b <= lost + 1e-9;
    const after = end !== null && s.a >= end - 1e-9;
    if (!s.appUp) { push(pool, s.a, s.b, HATCH, APP_DOWN); continue; }
    if (before) {
      const on = ap.sessionsOn ?? s.serving;
      push(pool, s.a, s.b, HANGING.has(s.servingState ?? '') ? AMBER : TEAL,
        HANGING.has(s.servingState ?? '')
          ? ['Commits hang — the primary cannot write redo anywhere', 'Commits hang', 'Hanging']
          : reachedOf(s).length >= 2 && on !== null
            ? [`Pooled sessions working on ${nameOf(on as string)}`, 'Working', 'OK']
            : ['Pooled sessions working', 'Working', 'OK']);
      continue;
    }
    if (after) {
      if (s.serving !== null) {
        push(pool, s.a, s.b, TEAL,
          [`Pool rebuilt on ${nameOf(s.serving as string)}`, 'Pool rebuilt', 'OK']);
      } else {
        push(pool, s.a, s.b, HATCH,
          ['Sessions lost — the service is gone again', 'Sessions lost', 'Lost']);
      }
      continue;
    }
    /* Between the loss and the reconnect. */
    const a = Math.max(s.a, lost ?? s.a);
    const b = end === null ? s.b : Math.min(s.b, end);
    if (severed) {
      push(pool, a, b, AMBER,
        ['In-flight calls hang — a partition returns no errors', 'Calls hang — pool unusable', 'Hanging']);
    } else {
      const burst = Math.min((lost ?? a) + ERROR_BURST, end ?? Infinity);
      push(pool, a, Math.min(b, burst), HATCH, ap.switchover
        ? ['Terminated as the primary converts', 'Terminated']
        : ['In-flight calls error — ORA-3113', 'Errors']);
      push(pool, Math.max(a, burst), b, AMBER,
        ['Pool empty — requests wait or fail', 'Pool empty', 'Empty']);
    }
    if (end !== null && s.b > end) {
      if (s.serving !== null) {
        push(pool, end, s.b, TEAL,
          [`Pool rebuilt on ${nameOf(s.serving as string)}`, 'Pool rebuilt', 'OK']);
      } else {
        push(pool, end, s.b, HATCH,
          ['Sessions lost — the service is gone again', 'Sessions lost', 'Lost']);
      }
    }
  }

  /* ---- lane 3: the connect string at work ---- */
  const ladderFrom = quiet ? null : ap.startAt;
  const ladderTo = ap.tConn ?? ap.gaveUp;
  type Look = Omit<AppBand, 'a' | 'b' | 'labels'>;
  const FAILING = ['New connections fail — the service is out of reach', 'Failing', '—'];
  /** What the lane says over a stretch the ladder does not cover. */
  const outside = (sp: AppSpan, a: Seconds): [Look, string[]] => {
    if (!sp.appUp) return [HATCH, APP_DOWN];
    if (ap.tConn === null && ap.gaveUp !== null && a >= ap.gaveUp - 1e-9) {
      return [SLATE, ['No more attempts — the string is exhausted', 'String exhausted', '—']];
    }
    if (sp.serving === null) return [AMBER, FAILING];
    if (ap.tConn !== null && a >= ap.tConn - 1e-9) {
      const toll = ap.retryCost - ap.estab;
      return [TEAL, toll > 1
        ? [
          `Connected — each later connect still pays ${fmt(toll)} s ahead of the address that answers`,
          'Connected — still paying the timeout', 'Connected',
        ]
        : ['Connected — the refused address costs almost nothing', 'Connected', 'OK']];
    }
    const both = reachedOf(sp);
    if (both.length >= 2) {
      const first = nameOf(both[0]?.member as string);
      return [TEAL, client.loadBalance
        ? ['New connections land on either — LOAD_BALANCE picks the order', 'Land on either', 'OK']
        : [`New connections land on ${first} — the first address that publishes`, `Land on ${first}`, 'OK']];
    }
    if (quiet) {
      return [TEAL, HANGING.has(sp.servingState ?? '')
        ? ['The listener still answers — connections are accepted throughout', 'The listener still answers', 'Connects']
        : ['New connections are accepted throughout', 'Connects', 'OK']];
    }
    return [SLATE, ['Any request connects at once', 'Connects at once', '—']];
  };
  for (const sp of spans) {
    const pieces: [Seconds, Seconds][] = ladderFrom === null || ladderTo === null
      ? [[sp.a, sp.b]]
      : [[sp.a, Math.min(sp.b, ladderFrom)], [Math.max(sp.a, ladderTo), sp.b]];
    for (const [a, b] of pieces) {
      if (b <= a) continue;
      const [look, labels] = outside(sp, a);
      push(conn, a, b, look, labels);
    }
  }

  /* The ladder itself, over whatever the spans drew in its stretch. */
  if (ladderFrom !== null && ladderTo !== null) {
    const att = ap.attempts;
    const ladder: AppBand[] = [];
    const add = (a: Seconds, b: Seconds, look: Look, labels: string[]): void => {
      const x0 = Math.max(t0, a);
      const x1 = Math.min(t1, b);
      if (x1 > x0) ladder.push({ a: x0, b: x1, ...look, labels });
    };
    if (att.length > 12) {
      const failed = ap.tConn !== null ? att.length - 1 : att.length;
      const last = att[att.length - 1];
      const failEnd = ap.tConn !== null ? (last?.start ?? ladderFrom) : ladderTo;
      add(ladderFrom, failEnd, AMBER, [
        `${failed} failed ${failed === 1 ? 'traversal' : 'traversals'} — no address connects`,
        `${failed} failed ${failed === 1 ? 'traversal' : 'traversals'}`,
        'Retrying',
      ]);
      if (ap.tConn !== null && last) {
        add(last.start, last.end, AMBER, [`The traversal that connects, ${fmt(last.end - last.start)} s`, `${fmt(last.end - last.start)} s`]);
      }
    } else {
      for (const at of att) {
        for (const d of at.dials) {
          const n = d.index + 1;
          const where = hostName(d.host as string);
          if (d.kind === 'timeout') {
            add(d.at, d.end, AMBER, [
              `Address ${n} (${where}) — no answer, ${fmt(d.cost)} s`,
              `Address ${n} — ${fmt(d.cost)} s`, `${fmt(d.cost)} s`,
            ]);
          } else if (d.kind === 'establish') {
            add(d.at, d.end, TEAL, [`Address ${n} connects`, 'connects']);
          } else {
            add(d.at, d.end, HATCH, d.kind === 'refuse'
              ? [`Address ${n} (${where}) — ORA-12514`, 'ORA-12514']
              : [`Address ${n} (${where}) — refused by the host`, 'refused']);
          }
        }
      }
    }
    conn.bands = [...conn.bands, ...ladder].sort((x, y) => x.a - y.a);
  }

  /* ---- the reading over the lanes, and its two marks ---- */
  const marks: AppMark[] = [];
  let note: string;
  let tone: AppSection['tone'] = 'ink';
  if (ap.noEventKind === 'app-down') {
    note = 'the application is down with its host, so nothing is dialled';
    tone = 'f-rd';
  } else if (ap.noEvent) {
    note = ap.noEventKind === 'stalled'
      ? 'nothing moves here, but every commit on the primary is hanging'
      : ap.noEventKind === 'switchover-refused'
        ? 'the broker refused the switchover, so the service never left the primary'
        : 'the service never leaves its reach, so there is nothing for the connect string to survive';
    if (ap.noEventKind === 'stalled') tone = 'f-am';
    /* Two databases publish it and the sessions' own stays up: nothing is lost. */
    const two = ap.noEventKind === 'continues'
      ? ap.spans.map(reachedOf).find((r) => r.length >= 2) : undefined;
    if (two !== undefined) {
      const names = two.map((p) => nameOf(p.member as string));
      note = `${joined(names)} ${names.length === 2 ? 'both' : 'all'} publish the service — the sessions stay on ${nameOf(ap.sessionsOn as string)}`;
      tone = 'f-am';
    }
  } else if (ap.tConn !== null) {
    const out = ap.tConn - (lost ?? ap.startAt);
    const inside = ap.tService === null ? 0 : ap.tConn - ap.tService;
    note = inside > ap.estab + 0.05
      ? `outage ${fmt(out)} s — ${fmt(inside)} s of it inside the connect string`
      : `outage ${fmt(out)} s`;
    marks.push({
      key: 'reconnect', t: ap.tConn, tone: 'f-vi',
      label: `Application reconnected at t = ${fmt(ap.tConn)} s`,
    });
  } else {
    note = ap.gaveUp === null
      ? 'the application stays down'
      : `the connect string is exhausted at t = ${fmt(ap.gaveUp)} s — the application stays down`;
    tone = 'f-rd';
    if (ap.gaveUp !== null) {
      marks.push({
        key: 'exhausted', t: ap.gaveUp, tone: 'f-rd',
        label: `Connect string exhausted at t = ${fmt(ap.gaveUp)} s`,
      });
    }
  }

  return {
    lanes, note, tone, marks,
    basis: `This page's model. ${ap.claims.vantage.value}; ${ap.claims.nominal.value}. ${ap.claims.nominal.note ?? ''}${
      ap.claims.overlap === undefined ? '' : ` ${ap.claims.overlap.value}. ${ap.claims.overlap.note ?? ''}`}`.trim(),
  };
}
