/**
 * The footnotes: the five ported from the legacy fragment's `.foot` block,
 * plus a sixth for the 19c self-contradiction around FastStartFailoverLagLimit
 * in MaxAvailability (ED-03).
 *
 * They say which numbers on the page are drawing constants rather than
 * documented figures -- the same job the `<Fact>` chip does inline, kept for
 * the ones that qualify a whole panel.
 */

import type { VNode } from 'preact';
import { Fact, M } from './facts-ui';

export interface Footnote {
  n: number;
  body: VNode;
}

export const FOOTNOTES: Footnote[] = [
  {
    n: 1,
    body: (
      <p>
        The threshold is skipped entirely for user-configurable health conditions and for
        application-initiated failover through <M>DBMS_DG.INITIATE_FS_FAILOVER</M>. Neither is drawn
        on the timeline. The detection time drawn when the two <M>ObserverPing*</M> properties are
        set{' '}&mdash;{' '}
        <Fact
          id="FSFO.PING_NEARLY_ONE_SECOND"
          basis="model"
          note="The documentation states only that the threshold is then ignored and that detection can be reduced to nearly one second."
        >
          interval &times; (retries + 1)
        </Fact>{' '}
        &mdash; is this page&rsquo;s model as well: the documentation states only that the threshold
        is then ignored and that detection can be reduced to nearly one second.
      </p>
    ),
  },
  {
    n: 2,
    body: (
      <p>
        Apply-time figures are illustrative. Terminal recovery is modelled one-to-one against the
        apply lag at failure time so the relationship is visible; real duration depends on the redo
        volume left and on the environment.
      </p>
    ),
  },
  {
    n: 3,
    body: (
      <p>
        Client-side constants in the application view are nominal: an <M>ORA-12514</M> refusal is
        drawn as 0.2 s, an OS-level refusal as 0.15 s, session establishment as 0.3 s, the
        broker&rsquo;s pre-switchover checks as 1 s, and the primary&rsquo;s conversion to a standby
        as 2 s. The role-based service is assumed registered the instant the new primary opens. The
        former primary&rsquo;s restart band deliberately ends without a marker; the new
        primary&rsquo;s open never waits for it.
      </p>
    ),
  },
  {
    n: 4,
    body: (
      <p>
        The reopen panel is idealized: retries are drawn at exact <M>ReopenSecs</M> multiples
        (transport really retries at the first log switch after the interval), the gap drains at five
        times the generation rate, and the apply lag grows from near zero at one second per second,
        which puts the MaxPerformance marker exactly one <M>FastStartFailoverLagLimit</M> after the
        break. The commit panel draws RFS processing as zero and lets <M>ASYNC</M> redo leave as soon
        as the local write finishes.
      </p>
    ),
  },
  {
    n: 5,
    body: (
      <p>
        Oracle&rsquo;s own 26ai pages disagree with themselves about <M>FastStartFailoverLagLimit</M>.
        The fast-start failover chapter&rsquo;s <em>Fast-start Failover Protection Modes</em> section,
        the per-mode defaults and the <M>V$FAST_START_FAILOVER_CONFIG</M> modes all describe the
        MaxAvailability behavior above; the chapter&rsquo;s <em>Task 3</em> and the closing line of
        the property page still carry the 19c sentence saying the property is used only in maximum
        performance mode. This page follows the protection-modes section.
      </p>
    ),
  },
  {
    n: 6,
    body: (
      <p>
        Under 19c, <M>FastStartFailoverLagLimit</M> in MaxAvailability is a separate, older
        self-contradiction: the fast-start failover chapter says the property &ldquo;must be set to
        zero&rdquo; for zero data loss there, while the property page says the property is used only
        in MaxPerformance. A live 19.27 system in MaxAvailability prints &ldquo;Lag Limit: 30 seconds
        (not in use)&rdquo;, which is the behaviour this page follows &mdash; the limit is not
        evaluated in MaxAvailability under 19c. The MaxAvailability role itself is a 21c feature, not
        a 26ai one; 26ai&rsquo;s own contribution is the per-mode default of 0 (footnote 5 is 26ai&rsquo;s
        own, separate disagreement about the same property).
      </p>
    ),
  },
];

/** The marker in the prose. Not a link: the app owns the fragment identifier. */
export function Fn({ n }: { n: number }): VNode {
  return (
    <sup class="ct-fn" aria-label={`footnote ${n}`}>
      {n}
    </sup>
  );
}

export function Footnotes(): VNode {
  return (
    <div class="ct-footnotes">
      <p class="ct-eyebrow">Footnotes</p>
      {FOOTNOTES.map((f) => (
        <div class="ct-footnote" key={f.n}>
          <span class="ct-fn-n">{f.n}</span>
          {f.body}
        </div>
      ))}
    </div>
  );
}
