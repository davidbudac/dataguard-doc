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
import { startClassicWalkthrough } from './Walkthrough';

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
        'Read-only preview. Open Build to select, move or edit the drawing.'
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
    d: <>Receives and applies redo. It can become the primary after a role change.</>,
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
        The label shows the transport mode (<span class="mono">SYNC</span> or{' '}
        <span class="mono">ASYNC</span>) and round-trip time between sites.
      </>
    ),
  },
  {
    k: '05',
    t: 'The rectangles',
    d: <>Data centres. In Build you add members to one; in Simulate you can lose a whole one.</>,
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
    what: 'Draw a Data Guard configuration.',
    you: 'Add data centres, databases, far syncs and observers. Connect members to route redo.',
    cta: 'Draw the classic 1+1+1',
    go: () => jump({ preset: 'classic', mode: 'build' }),
  },
  {
    name: 'Simulate',
    glyph: g(<><path d="M11 2.5 5.5 11h4l-1 6.5L15 9h-4z" /></>),
    what: 'See how the configuration responds to a failure.',
    you: 'Crash a host, cut a link or take a site down. Follow the timeline to see what happens.',
    cta: 'Isolate a far sync site',
    go: () => jump({ preset: 'far-sync-zero-loss', scenario: 'isolated', mode: 'break' }),
  },
  {
    name: 'Config',
    glyph: g(<><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M5.5 8l2.5 2-2.5 2M10.5 12.5h4" /></>),
    what: 'Generate the configuration from the drawing.',
    you: 'Review the DGMGRL commands, LOG_ARCHIVE_DEST_n, tnsnames and JDBC generated from it.',
    cta: 'Print the DGMGRL commands',
    go: () => jump({ preset: 'classic', mode: 'configure', panel: 'dgmgrl' }),
  },
  {
    name: 'Learn',
    glyph: g(<><path d="M3 4.5h5.5A1.5 1.5 0 0 1 10 6v10a1.5 1.5 0 0 0-1.5-1.5H3zM17 4.5h-5.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H17z" /></>),
    what: 'Work through nine lessons.',
    you: 'Each lesson has a live configuration. Press "Show me" to load the step beside the text.',
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
        Click a card, data centre or link to select it and inspect its properties.
        Use <span class="mono">⋯</span> or right-click for actions. Double-click a name or
        press <span class="mono">F2</span> to rename it. Drag across the background to select
        several cards;{' '}
        <span class="mono">Ctrl+A</span> selects them all.
      </>
    ),
  },
  {
    k: 'Add something',
    d: (
      <>
        Click a <span class="mono">+</span> button to add a member, or drag it onto a data
        centre. You can name the new member immediately.
      </>
    ),
  },
  {
    k: 'Move and connect',
    d: (
      <>
        Drag a card or selection to move it. <span class="mono">Alt</span> with an arrow
        nudges it; <span class="mono">Tidy</span> resets its position. Drop a member in
        another data centre to move its host there. Drag between card ports to route redo
        (RedoRoutes), or from a member to an observer to name a fast-start failover target.
        Drag between data centre ports to add a site link. <span class="mono">Ctrl+Z</span>{' '}
        undoes the change.
      </>
    ),
  },
  {
    k: 'Remove something',
    d: (
      <>
        Use <span class="mono">Remove</span> on the action bar or press{' '}
        <span class="mono">Delete</span>. If removal is unavailable, the control explains why.
      </>
    ),
  },
  {
    k: 'Break something',
    d: (
      <>
        In Simulate, click a host to crash it or a link to cut it. The event starts at the
        playhead. Drag the playhead to inspect another moment.
      </>
    ),
  },
  {
    k: 'Read the configuration',
    d: (
      <>
        Config generates each tab from the drawing. Hover a line to highlight its member.
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
        <span class="mono">Share</span> copies a link containing the drawing, events and
        parameters. The page stores nothing on a server.
      </>
    ),
  },
  {
    k: 'Turn the explanations on',
    d: (
      <>
        Turn on <span class="mono">Hints</span> in the inspector header to show an explanation
        under each control. The setting is remembered.
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
        The broker changes the primary role automatically. With default detection settings and
        <span class="mono"> ObserverOverride = FALSE</span>,{' '}
        <Fact id="FSFO.BOTH_MUST_HAVE_LOST">
          the observer and target standby must both lose contact with the primary for{' '}
          <span class="mono">FastStartFailoverThreshold</span> seconds
        </Fact>
        , and the target must pass the readiness check.
      </>
    ),
  },
  {
    k: 'SYNC and ASYNC',
    d: (
      <>
        How redo leaves the primary: waiting for the standby to acknowledge it, or not. On the
        drawing a solid line is <span class="mono">SYNC</span>, a dashed one{' '}
        <span class="mono">ASYNC</span>, and Simulate shows what each costs when something fails.
      </>
    ),
  },
  {
    k: 'Protection mode',
    d: (
      <>
        The configuration&rsquo;s data loss policy: maximum performance, maximum availability
        or maximum protection. The readout shows the protection level it reaches, which can
        differ from the mode selected; validation says when the drawing cannot keep it.
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
          Draw a configuration, simulate a failure and generate its settings.
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
          <button type="button" class="btn" onClick={startClassicWalkthrough}>
            Walk through it step by step
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
        lead="The classic example: a primary, a standby in a second data centre and an observer in a third. The workbench opens on it, and most lessons use it."
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
        lead="Use the header buttons to switch modes. A shared link opens in the mode you selected."
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
          For all keyboard shortcuts, open{' '}
          <button
            type="button"
            class="ip-inline"
            onClick={() => { leaveIntro(); introOpen.value = true; }}
          >
            Help (?) in the header
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
          <a href={LEGACY_PATH}>the original single-page explainer</a>.
        </p>
      </footer>
    </article>
  );
}
