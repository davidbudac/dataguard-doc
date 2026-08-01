# Fix plan: incorporating the 2026-08-01 fact-check into the FSFO simulator

Basis: `FSFO_SIMULATOR_FACT_CHECK_2026-08-01.md`, including its **Independent
verification** section — every P0/P1 finding there is confirmed against Oracle
documentation, so this plan treats them as settled facts, with the three
qualifications noted in that section folded in.

Line references are to the audited snapshot (commit `0fdaf04`). Current HEAD =
snapshot +10 after line 427, +15 after 2174, +18 after 2275 (the footer commit).
Locate edits by the quoted anchor text, not the number.

## Ground rules for every workstream

- **19c edition behavior and text do not change** (except the narrow prose fixes
  in WS6, which are edition-independent). Everything 26ai-specific lands through
  the existing edition mechanism: `V26` source-string substitutions in `DG.t()`,
  `data-ver="26"` blocks, and `c.version` branches in the models.
- **The English-string cascade.** The `V26` table and `simulator/i18n/cs.json`
  are both keyed by the *exact* English source string. Editing any English
  string therefore requires, in the same batch: (1) updating the matching `V26`
  key if one exists, (2) renaming the `cs.json` key and re-reviewing its Czech
  value, (3) checking `site/test.mjs` for string greps. Verify with the
  `DG.missing()` headless probe in BOTH editions (rebuild from the AGENTS.md
  extraction section) and confirm the cs→en round trip stays byte-identical.
- **ASCII rule** for the fragment: entities in markup, `\uXXXX` in JS strings —
  but the Edit tool decodes `\uXXXX`, so new JS literals use
  `String.fromCharCode` or plain ASCII. `node site/build.mjs` is the gate.
- **Work in a git worktree** (concurrent sessions have collided before).
- Gates before commit: `node site/build.mjs`, `node --test site/test.mjs`,
  i18n probe. Publish (`./site/publish.sh`) only on explicit request.
- Builder/reviewer split per the model rules: opus-5 builders per workstream,
  fable review pass at the end.

## Pre-work: three micro doc-checks (cheap, do first)

1. **Is `FastStartFailoverLagType`/`LagGraceTime` still MaxPerformance-only in
   26ai?** The fact-check says yes; WS1 keeps `lagStall` gated to MaxPerformance
   on that basis. Confirm on the two property pages before building.
2. **Official citations for SQLcl broker commands and ORDS REST** (WS6 item h).
   If none found, the row stays blog-attributed.
3. **"Four observers since 21c"** (the V26 table row says "since 21c"; verified
   only for 26ai). Check the 21c broker guide; if unconfirmed, drop "since 21c".

## WS1 — 26ai MaxAvailability LagLimit semantics (P0 #1; the big one)

Target behavior, 26ai edition only (19c unchanged):

- MaxAvailability + LagLimit **0** (the 26ai MaxAvailability default): zero data
  loss; standby must have all redo. Drawings identical to today's 19c ones.
- MaxAvailability + LagLimit **nonzero**: fast-start failover permitted while
  apply lag ≤ limit; data loss bounded by the limit (mirrors today's
  MaxPerformance readiness/data-loss story).
- LagType/LagGraceTime stay MaxPerformance-only (subject to pre-work check 1).
- Cite the 26ai chapter's "Fast-start Failover Protection Modes" section, the
  per-mode defaults, and `V$FAST_START_FAILOVER_CONFIG`'s ZERO/POTENTIAL DATA
  LOSS modes — **not** Task 3 or the LagLimit property page's closing line,
  which still carry the stale "maximum performance mode" sentence. Add a short
  footnote acknowledging that internal contradiction so readers who hit the
  stale sentences aren't left thinking the page is wrong.

Decision needed (recommendation embedded):

- **D1 — UI affordance for LagLimit 0.** The rail slider's min is 5 and the
  value is shared with MaxPerformance. Recommended: a `data-ver="26"` two-state
  control shown only under 26ai + MaxAvailability — "zero data loss (LagLimit 0,
  default)" vs "bounded (use the LagLimit slider)" — rather than reworking the
  shared slider's range. Default = zero loss, so existing links/configs and all
  19c-equivalent drawings are untouched; the new model field defaults off
  in-model (same pattern as `observerLoc`), so saved configs stay valid.

Touch points (anchors):

- Rail note `n-laglimit` ("MaxPerformance only. Not evaluated in
  MaxAvailability…", ~930): V26 variant describing both modes.
- Readiness note ("In MaxAvailability and MaxProtection the standby must have
  been synchronized…", ~1042) and the disarm note ("UNSYNCHRONIZED from the
  first second in MaxAvailability…", ~1385): V26 variants.
- ASYNC caption ("eligibility and data loss are bounded by
  FastStartFailoverLagLimit instead", ~2049) — still true for MaxPerformance;
  V26 variant should note MaxAvailability joins it when the limit is nonzero.
- "Deliberately unchanged in 26ai" caption (~2104): **wrong as written** — the
  LagLimit default and semantics DID change for MaxAvailability. Rewrite: the
  numbers drawn (threshold, ping, PmyShutdown) are unchanged; LagLimit gains a
  MaxAvailability role with default 0.
- 26ai change table: add a row for the MaxAvailability LagLimit change (it is
  currently absent — the table's "first three rows change behavior" claim
  becomes four).
- Reference row (~2125-26 "MaxPerformance only…"): V26 variant.
- Commit-chapter ASYNC card V26 string (~2220): add that the 26ai prerequisites
  table allows ASYNC MaxAvailability targets, while zero loss still needs
  SYNC/FASTSYNC (**D2**, recommended: yes, one sentence).
- `LAGTYPE_NOTES.avail` / `LAG26_NOTES.avail` (~3361, 3368): reword — "readiness
  means synchronized" no longer covers 26ai nonzero-limit MaxAvailability.
- Model `computeFsfo`: `blocked` (~2747) — under v26 + maxavail + bounded:
  `standbyLag > lagLimit`; `dataLossKind` (~2764) — v26 + maxavail + bounded →
  `'bounded'`. Zero-loss state keeps today's behavior.
- Model `computeReopen`: `fsfoLostAt` (~3095) — v26 + maxavail + bounded →
  `lagLimit` instead of 0.
- Generated DGMGRL (~5634-39): v26 branch — in MaxAvailability print the
  LagLimit command with a "(0 = zero data loss, the 26ai MaxAvailability
  default)" note instead of "not evaluated".
- Tests: new 26ai cases (maxavail + limit 0 → dataLoss none / never bounded;
  maxavail + nonzero → bounded, blocked when lag > limit; reopen `fsfoLostAt`);
  the 19c-invariance loops must keep pinning current behavior for version
  absent/'19c'; update the tests the fact-check lists at 492-503 / 721-761.
- i18n: cs entries for every new/changed string, both editions probed.

## WS2 — PrimaryDatabaseCandidates (P0 #2; prose-only, small)

Rewrite the 26ai change-table row (~2089-91) and the reference row (~2131-32) to
the verified semantics: restricts **switchover and failover when fast-start
failover is disabled**; an excluded target is rejected with ORA-16529; when FSFO
is enabled it adds no new restriction (`FastStartFailoverTarget` already governs
the target). Delete the current "fence around fast-start failover / manual
failover to an excluded member still works" text — it is backwards.

**D3 — the 19.26 backport claim.** Not in any official source (the 19.26 RU page
says "no new features"; the 19c broker PDF has zero occurrences). Recommended:
keep but hedge and attribute — "reported as backported to 19.26 by the Data
Guard product manager's blog; not reflected in Oracle's RU documentation" —
since the row already cites Caldara. Alternative: drop the sentence.

Cascade: V26 keys (the reference row has `data-ver="26"`, the change-table row
is 26ai-edition markup), cs.json, README citation list (add the property page
and ORA-16529).

## WS3 — Both-sites topology and nomination (P0 #3)

**D4 — scope.** Recommended: **keep the `dc1dc2` control 26ai-gated** (option B)
and fix the prose; do NOT build 19c both-sites modeling (option A would add a
fifth 19c matrix column, model branches, and ~30 test-cell updates for little
teaching value). The honest framing option B needs:

- 26ai change-table row (~2074-76) and `V19_NOTES.obsBoth` (~3355): 19c already
  registers up to three observers, has `PreferredObserverHosts`, and nominates a
  backup when the master is lost — what 26ai adds is the fourth observer and
  automatic relocation of the master to the highest-priority preferred host
  (19c applies the preference only at the next role change). The page *models*
  both-sites only under 26ai as a modeling choice; say so.
- Also fix the V26 substitution pair at ~2216-17 accordingly, and re-check the
  "since 21c" claim (pre-work 3).

Nomination-precondition honesty (both editions of the docs say nomination
happens "if the primary and target standby databases stay connected but the
connection to the master observer is lost"; no nomination when a database has
lost all backup observers):

- `MULTI_NOTES.nominate` and `.partition` (~3374-77) and any both-sites drawing
  caption: add one sentence stating the documented precondition and that the
  partition/isolated outcomes extend it by inference, pending a 26ai runtime
  test. Mirror the existing README footnote †.
- `diagrams/README.md`: extend footnote † to the `isolated`+both-sites cell;
  update the MATRIX26 comment in `site/test.mjs` to cover both cells. The
  asserted outcomes themselves stay (they are now flagged, which is what the
  fact-check asks: "mark those cells unverified").
- Future work note: cannot be lab-validated on dbmint (19c only).

## WS4 — Unobserved vs disabled, query-side status (P0 #4)

The confirmed error: the page pairs the standby-side status `PRIMARY UNOBSERVED`
with the primary-side `FS_FAILOVER_OBSERVER_PRESENT = NO` and never says which
database is queried. Documented reality (19c Table 5-1 + worked example): the
**primary** reports `SYNCHRONIZED` with observer-present `NO`; the **target
standby** reports `PRIMARY UNOBSERVED` with observer-present `YES`; ORA-16820 is
raised for a previously-observing observer.

- Rewrite the three string clusters — the "No observer, no fast-start failover"
  note (~1069-70) plus its V26 pair (~2216-17), the unobserved callout pair
  (~2253-54), and its render site (~4569) — to name the query side explicitly,
  e.g. "on the primary, FS_FAILOVER_STATUS stays SYNCHRONIZED and
  FS_FAILOVER_OBSERVER_PRESENT reads NO; the target standby is where
  FS_FAILOVER_STATUS reads PRIMARY UNOBSERVED".
- Retitle the ~1069 note (its body describes a *lost* observer; "No observer, no
  fast-start failover" reads as the deployed-none state) — e.g. "An unobserved
  configuration cannot fail over". The deployed-none note at ~1084 already
  draws the distinction; optionally add that `FS_FAILOVER_STATUS` simply reads
  `DISABLED` there (also in the generated-config note ~5613-18).
- The `observerLoc=none` → "disabled" model convention stays (the fact-check
  accepts it as an explicit convention); test 369-418 keeps its invariant, gains
  a comment.
- Heaviest string-cascade workstream: every rewritten string has a cs.json key
  and two have V26 keys. Budget probe + round-trip time.

## WS5 — ObserverOverride scope (P1, small)

- Add one sentence to the "Both the observer and the standby must have lost the
  primary" note (~1037-38): this is the default `ObserverOverride = FALSE`
  behavior; set TRUE, the observer may initiate failover on losing the primary
  even while the standby still reaches it. Everything on the page assumes FALSE.
- Add an `ObserverOverride` row to the broker-properties reference table
  (default FALSE, one-line description).
- `diagrams/README.md` matrix preamble + `site/test.mjs` matrix comment
  (191-204): state the FALSE assumption. No model change.

## WS6 — Narrow prose fixes (P1/P2, one batch)

a. **AutoReinstate** (~1158, ~2135-36): qualify — applies to crash/isolation
   FSFO only (never user-condition or `DBMS_DG.INITIATE_FS_FAILOVER`), needs
   Flashback Database on both, the old primary restarted to mount (manually if
   PmyShutdown aborted it), observer connectivity, and static services without
   Clusterware/Restart. Keep the sequence-diagram line short; the reference row
   carries the conditions.
b. **Manual failover** (~1086, ~5678): replace "always available" with "needs no
   observer when fast-start failover is disabled, subject to the broker's
   failover prerequisites"; with FSFO enabled it is target-only with extra
   conditions (FORCE only to leave the target).
c. **TAF vs Application Continuity** (~1520): split — TAF reconnects and can
   resume SELECT fetches but rolls back active transactions; Application
   Continuity can replay eligible in-flight work when configured, and replay
   can be rejected.
d. **NET_TIMEOUT wording** (~2045): "A shorter NET_TIMEOUT only moves when the
   hanging starts" → "only moves the transport-error/STALLED boundary; the ack
   wait begins the moment the ack stops" (matches the drawing's own brace label
   at ~2018).
e. **VALIDATE FAST_START FAILOVER** (~2077-78, ~5661-63): drop "placement";
   align the listed checks with the documented list (properties, blockers,
   post-failover issues, stability, callout scripts; observer *started*, not
   "connectivity").
f. **Ping formula labeling** (~1050, ~2140, ~5627-29): the docs say only that
   the threshold "is ignored" and detection reaches "nearly 1 second" —
   `interval × (retry + 1)` is this page's interpretation. Scope the "per the
   broker documentation" attribution to the ignored-threshold sentence and
   label the formula as the model's reading. Add the same caveat comment to
   test 86-97 and the README fact list.
g. **Observer view row** (~2087): "the observer's clock" → drop; CURRENT_TIME is
   the time the view was queried; add "defined when queried on the primary".
h. **Scripting-surfaces row** (~2093): split per pre-work 2 — officially cited
   facts (DGMGRL JSON, DBMS_DG API) stated as fact; SQLcl/ORDS attributed to
   the blog unless an official cite is found.

All are English-string edits → full V26/cs.json/test-grep cascade applies.

## WS7 — Closing sweep

- `diagrams/README.md`: updated facts + new citations (26ai protection-modes
  section, LagLimit property page with the contradiction note,
  PrimaryDatabaseCandidates, ORA-16529, Table 5-1 / V$DATABASE worked example,
  ObserverOverride, V$FS_FAILOVER_OBSERVERS, TAF/AC pages).
- `AGENTS.md`: accuracy-rule bullets for the new facts; note the assumptions the
  page now states (ObserverOverride=FALSE, nomination inference cells).
- cs.json full delta, `DG.missing()` probe in both editions, cs→en round trip.
- Test count will rise past 65; update any doc that quotes "65".
- `node site/build.mjs` + `node --test site/test.mjs` green; commit per
  workstream or as one reviewed series; publish only on request.

## Order and sizing

| # | Workstream | Size | Depends on |
|---|---|---|---|
| 0 | Pre-work doc checks | XS | — |
| 1 | WS1 LagLimit/MaxAvailability | L (model+UI+prose+tests+i18n) | pre-work 1, D1, D2 |
| 2 | WS2 PrimaryDatabaseCandidates | S (prose) | D3 |
| 3 | WS3 both-sites honesty | M (prose+README+tests) | D4, pre-work 3 |
| 4 | WS4 unobserved/disabled | M (prose, heavy cascade) | — |
| 5 | WS5 ObserverOverride | S | — |
| 6 | WS6 narrow fixes | M (many small strings) | pre-work 2 |
| 7 | WS7 sweep + review | M | all |

Decisions D1-D4 have recommendations embedded above; proceeding on the
recommendations unless overridden.
