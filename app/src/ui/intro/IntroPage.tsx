/**
 * The Introduction (ui.md SS3e).
 *
 * The verdict this answers was "make an Introduction website which would
 * kinda explain what's going on and explain more in detail what to do", and
 * then, of the first draft, "it's again a lot of text still -- make it a
 * little bit more useful, usable and nicer". So the shape is fixed:
 *
 *  - **Six bands, each with one job**, separated by air rather than by boxes:
 *    what this is, what the drawing shows, the four modes, how to do things,
 *    five words, and where the old page went.
 *  - **Nothing is a paragraph that could be a row.** The how-to band is a
 *    definition list of one-line gestures; the glossary is five entries of at
 *    most two lines. This is the one page on which prose is welcome, and it is
 *    still read by scanning.
 *  - **Every claim about the workbench is a button that proves it.** Each mode
 *    card carries a "Try it" that loads a real configuration and lands in that
 *    mode (`route.ts`), so the page is a way in rather than a description of
 *    one.
 *
 * The drawing in the second band is the classic preset rendered read-only:
 * the same `TopoCanvas` the workbench draws with, given the same document,
 * so what a callout points at is what the reader will meet a click later.
 */

import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { declaredPrimary, resolveRedoGraph } from '@/engine';
import { Fact } from '@/content/facts-ui';
import { classic } from '@/presets';
import { TopoCanvas } from '@/ui/canvas/TopoCanvas';
import { LEGACY_PATH } from '@/state/legacy-url';
import { introOpen } from '@/state/view';
import { jump, leaveIntro, openLesson } from './route';

import '@/content/content.css';
import '@/styles/intro.css';

/* ---------------- the drawing ---------------- */

/**
 * The classic 1+1+1, drawn and not editable.
 *
 * Built here rather than read from the live document: the band explains what
 * the pieces of a Data Guard configuration are, and it has to show the shape
 * it names whatever the reader had open when they came back to this page.
 */
function ClassicDrawing(): JSX.Element | null {
  const drawn = useMemo(() => {
    const doc = classic.doc();
    const primary = declaredPrimary(doc);
    if (primary === null) return null;
    return { doc, graph: resolveRedoGraph(doc, { primary }) };
  }, []);
  if (drawn === null) return null;
  return (
    <TopoCanvas
      doc={drawn.doc}
      graph={drawn.graph}
      prefix="ip"
      interactive={false}
      readOnlyWhy={
        'Read-only here, on purpose. In Build this same drawing is the workbench: '
        + 'everything on it can be selected, moved and changed.'
      }
    />
  );
}

/** The pieces of that drawing, in the order the eye meets them. */
const CALLOUTS: { k: string; t: string; d: JSX.Element }[] = [
  {
    k: '01',
    t: 'The primary',
    d: <>The database applications connect to. Every redo arrow on the drawing leaves it.</>,
  },
  {
    k: '02',
    t: 'The standby',
    d: <>Receives that redo and applies it, ready to take the primary role when it has to.</>,
  },
  {
    k: '03',
    t: 'The observer',
    d: (
      <>
        A third process watching both, on a host of its own &mdash;{' '}
        <Fact id="OBS.PLACEMENT_NEVER_ON_DB_HOST">
          never at the primary or standby database server
        </Fact>
      </>
    ),
  },
  {
    k: '04',
    t: 'The redo line',
    d: (
      <>
        Its pill says how redo is shipped and how far it goes: the transport
        (<span class="mono">SYNC</span> or <span class="mono">ASYNC</span>) and the round-trip
        time between the two sites.
      </>
    ),
  },
  {
    k: '05',
    t: 'The rectangles',
    d: <>Data centres. In Build you add members to one; in Break you can lose a whole one.</>,
  },
];

/* ---------------- the modes ---------------- */

interface ModeCard {
  name: string;
  glyph: JSX.Element;
  what: string;
  you: string;
  cta: string;
  go: () => void;
}

/* Small, stroked, currentColor: the same drawing language as the icon buttons
   in the header, and no external asset anywhere on the page. */
const g = (d: JSX.Element): JSX.Element => (
  <svg class="ip-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false">{d}</svg>
);

const MODES: ModeCard[] = [
  {
    name: 'Build',
    glyph: g(<><rect x="2.5" y="4.5" width="7" height="5" rx="1" /><rect x="10.5" y="10.5" width="7" height="5" rx="1" /><path d="M6 9.5v3.5h4.5" /></>),
    what: 'The drawing is the workbench.',
    you: 'Add data centres, databases, far syncs and observers, and route the redo between them.',
    cta: 'Draw the classic 1+1+1',
    go: () => jump({ preset: 'classic', mode: 'build' }),
  },
  {
    name: 'Break',
    glyph: g(<><path d="M11 2.5 5.5 11h4l-1 6.5L15 9h-4z" /></>),
    what: 'The same configuration, with something wrong with it.',
    you: 'Crash a host, cut a link or take a site down, then read the clocks on the timeline.',
    cta: 'Isolate a far sync site',
    go: () => jump({ preset: 'far-sync-zero-loss', scenario: 'isolated', mode: 'break' }),
  },
  {
    name: 'Configure',
    glyph: g(<><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M5.5 8l2.5 2-2.5 2M10.5 12.5h4" /></>),
    what: 'The drawing, printed.',
    you: 'DGMGRL commands, LOG_ARCHIVE_DEST_n, tnsnames and JDBC, generated from what you drew.',
    cta: 'Print the DGMGRL commands',
    go: () => jump({ preset: 'classic', mode: 'configure', panel: 'dgmgrl' }),
  },
  {
    name: 'Learn',
    glyph: g(<><path d="M3 4.5h5.5A1.5 1.5 0 0 1 10 6v10a1.5 1.5 0 0 0-1.5-1.5H3zM17 4.5h-5.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H17z" /></>),
    what: 'Nine lessons, each with a live configuration beside it.',
    you: 'Read a step, press "Show me", and the workbench sets itself up for exactly that step.',
    cta: 'Open lesson 1',
    go: () => openLesson(0),
  },
];

/* ---------------- how to do things ---------------- */

const HOWTO: { k: string; d: JSX.Element }[] = [
  {
    k: 'Select and edit',
    d: (
      <>
        Click a card, a data centre or a link and its actions open beside it on the drawing;
        the full properties are in the inspector. Double-click a card to rename it.
      </>
    ),
  },
  {
    k: 'Add something',
    d: <>The <span class="mono">+</span> strip on the drawing, or &ldquo;Add &hellip; here&rdquo; on a data centre.</>,
  },
  {
    k: 'Move and connect',
    d: (
      <>
        Drag a card into another data centre and it moves there, host and all. Drag from
        the port on a card&rsquo;s right edge to another card: member to member ships redo
        (RedoRoutes), member to observer names a fast-start failover target.
      </>
    ),
  },
  {
    k: 'Remove something',
    d: (
      <>
        <span class="mono">Remove</span> on the action bar, or the <span class="mono">Delete</span>{' '}
        key. Nothing refuses in silence: what cannot be removed says why.
      </>
    ),
  },
  {
    k: 'Break something',
    d: (
      <>
        In Break, click a host to crash it or a link to cut it. Events land at the playhead,
        and the timeline underneath runs the clocks &mdash; drag it to any moment.
      </>
    ),
  },
  {
    k: 'Read the configuration',
    d: (
      <>
        Configure&rsquo;s tabs are generated from the drawing. Hover a line and the member it
        configures lights up.
      </>
    ),
  },
  {
    k: 'Zoom and pan',
    d: (
      <>
        The <span class="mono">&minus;</span> / <span class="mono">+</span> strip on the drawing,
        or ctrl/&#8984; with the wheel. Past 1:1, drag the background to move the view.
      </>
    ),
  },
  {
    k: 'Share it',
    d: (
      <>
        <span class="mono">Share</span> copies a link that carries the whole configuration &mdash;
        the drawing, the events and every parameter. Nothing is stored on a server.
      </>
    ),
  },
  {
    k: 'Turn the explanations on',
    d: (
      <>
        A sentence under each control is off by default. <span class="mono">Hints</span>, in the
        inspector header, brings them back and remembers that you wanted them.
      </>
    ),
  },
];

/* ---------------- five words ---------------- */

const WORDS: { k: string; d: JSX.Element }[] = [
  {
    k: 'Primary and standby',
    d: (
      <>
        The primary is the database in service; a standby holds a copy of it, kept current by
        the redo the primary ships. Either can end up holding the other&rsquo;s role.
      </>
    ),
  },
  {
    k: 'Observer',
    d: (
      <>
        A separate process that watches the primary and the failover target. Oracle puts it{' '}
        <Fact id="OBS.PLACEMENT_THIRD_SITE">
          ideally at a third site, so the primary, observer and standby have isolated
          infrastructure
        </Fact>
      </>
    ),
  },
  {
    k: 'Fast-start failover',
    d: (
      <>
        The broker failing over without anybody typing a command.{' '}
        <Fact id="FSFO.BOTH_MUST_HAVE_LOST">
          It happens when both the observer and the target standby have lost the primary for
          FastStartFailoverThreshold seconds
        </Fact>
      </>
    ),
  },
  {
    k: 'SYNC and ASYNC',
    d: (
      <>
        How redo leaves the primary: waiting for the standby to acknowledge it, or not. On the
        drawing a solid line is <span class="mono">SYNC</span>, a dashed one{' '}
        <span class="mono">ASYNC</span>, and Break shows what each costs when something fails.
      </>
    ),
  },
  {
    k: 'Protection mode',
    d: (
      <>
        The promise the whole configuration makes about losing data &mdash; maximum performance,
        maximum availability or maximum protection. The readout names the one in force, and the
        validation panel says when the drawing cannot keep it.
      </>
    ),
  },
];

/* ---------------- the page ---------------- */

function Band(
  { n, title, lead, children }:
  { n: string; title: string; lead?: string; children: JSX.Element | JSX.Element[] },
): JSX.Element {
  return (
    <section class="ip-band" aria-label={title}>
      <header class="ip-bandhd">
        <p class="eyebrow">{n}</p>
        <h2 class="ip-h2">{title}</h2>
        {lead === undefined ? null : <p class="ip-lead">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

export function IntroPage(): JSX.Element {
  return (
    <article class="ip">
      <header class="ip-hero">
        <p class="eyebrow">Introduction</p>
        <h1 class="ip-h1">
          A workbench for Oracle Data Guard topologies.
        </h1>
        <p class="ip-sub">
          Draw a configuration, break it, and read what the broker would do and what it would
          print.
        </p>
        <div class="ip-cta">
          <button
            type="button"
            class="btn is-primary"
            onClick={() => jump({ preset: 'classic', mode: 'build' })}
          >
            Start with the classic 1+1+1
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => jump({ preset: 'classic', scenario: 'crash', mode: 'break' })}
          >
            Watch a failover
          </button>
        </div>
        <p class="caption ip-hero-note">
          Nothing here connects to a database. Every number is arithmetic over what you typed, a
          documented fact with its source attached, or labelled where it is read as this
          page&rsquo;s model.
        </p>
      </header>

      <Band
        n="01"
        title="What you are looking at"
        lead="One primary, one standby in a second data centre, one observer in a third. It is the shape the workbench opens on, and the one most of the lessons use."
      >
        <div class="ip-figure">
          <div class="ip-drawing"><ClassicDrawing /></div>
          <ol class="ip-callouts">
            {CALLOUTS.map((c) => (
              <li key={c.k}>
                <span class="ip-callout-k mono">{c.k}</span>
                <span class="ip-callout-t">{c.t}</span>
                <span class="ip-callout-d">{c.d}</span>
              </li>
            ))}
          </ol>
        </div>
      </Band>

      <Band
        n="02"
        title="The four modes"
        lead="One configuration, seen four ways. The buttons in the header switch between them at any time, and every link you copy carries whichever one you were in."
      >
        <div class="ip-modes">
          {MODES.map((m) => (
            <article class="ip-mode" key={m.name}>
              <h3 class="ip-mode-t">
                {m.glyph}
                {m.name}
              </h3>
              <p class="ip-mode-w">{m.what}</p>
              <p class="ip-mode-y">{m.you}</p>
              <button type="button" class="btn" onClick={m.go}>{m.cta}</button>
            </article>
          ))}
        </div>
      </Band>

      <Band n="03" title="How to do things">
        <dl class="ip-rows">
          {HOWTO.map((r) => (
            <div class="ip-row" key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.d}</dd>
            </div>
          ))}
        </dl>
        <p class="caption ip-after">
          Every key this page binds is listed in one place:{' '}
          <button
            type="button"
            class="ip-inline"
            onClick={() => { leaveIntro(); introOpen.value = true; }}
          >
            the ? in the header
          </button>
          .
        </p>
      </Band>

      <Band n="04" title="Five words">
        <dl class="ip-rows ip-rows-words">
          {WORDS.map((r) => (
            <div class="ip-row" key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.d}</dd>
            </div>
          ))}
        </dl>
      </Band>

      <footer class="ip-foot">
        <p class="caption">
          Everything here is a model. Documented facts carry their source; everything else is
          labelled in place as this page&rsquo;s model.
        </p>
        <p class="caption">
          The page this one replaced is still served, frozen:{' '}
          <a href={LEGACY_PATH}>the original single-page explainer</a>, which also reads{' '}
          <a href={`${LEGACY_PATH}?lang=cs`}>in Czech</a>.
        </p>
      </footer>
    </article>
  );
}
