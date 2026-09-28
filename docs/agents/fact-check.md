# Fact check — how to review the workbench against Oracle

The procedure behind `SIMULATOR_FACT_CHECK_2026-09-28.md`, written so the next
review is a repeat rather than a reinvention. A fact check produces **a report
and nothing else**: no fix is made in the same pass, because a fix made while
reviewing is a fix nobody reviewed.

## When to run one

- Before publishing a change to `app/src/engine`, `app/src/presets`,
  `app/src/content` or the generators.
- When a feature adds an outcome the page did not draw before — a new event, a
  new member kind, a new property, a second role change.
- When Oracle's pages move. They do: the 19c library is edited in place and
  carries text from later releases (see *Traps*).

A full pass is eight slices (below). A change that touches one area re-runs
that slice and the probes; it does not need the other seven.

## Evidence rules

1. **Only Oracle is evidence.** `AGENTS.md`, `app/design/facts.md` and
   `diagrams/README.md` are the claims under test, not sources. A finding that
   cites them proves nothing.
2. **Quotes are matched with grep, never with a summariser.** Pull the pages
   with `app/test/fact-check/fetch-docs.sh`, which writes greppable text copies
   into a temp directory and prints its path. A tool that answers questions
   about a page paraphrases, and a paraphrase is what the check exists to catch.
3. **Both editions, every time.** For each 19c sentence open the 26ai page, and
   the 21c one when the question is *which release* changed something. 26ai
   splits properties and commands into one page each; find names in
   `26/dgbkr/toc.htm`.
4. **A finding needs the sentence.** Verbatim quote, URL, edition, and what the
   page shows instead. "Absent from the page" is a valid finding only when the
   page was grepped whole.
5. **A model is judged differently from a fact.** Something labelled `model` or
   `inferred` is wrong only where a documented sentence contradicts it.
   Something labelled `documented` is wrong when no sentence says it.
6. **A live database outranks a page, and is labelled as such.** Where a real
   configuration is available, read it — read-only — and record the release
   update. Documentation and binaries disagree more often than expected.

## The three tools

### 1. Pages

```bash
dir=$(app/test/fact-check/fetch-docs.sh)      # prints the temp directory
grep -n -i 'stall' "$dir/b19-fsfo.txt"
```

Add a page to the list in the script when a slice needs one. Nothing is written
inside the repository.

### 2. Probes

```bash
cd app && npx vitest run --config vitest.factcheck.config.ts
```

`app/test/fact-check/probes.probe.ts` holds one probe per finding that can be
shown by running the engine: a document, an event list, the Oracle sentence, and
a predicate that is true while the page still shows what the report recorded.
The run prints `OPEN` or `CHANGED` per finding and never fails.

- `CHANGED` means the behaviour moved, **not** that it is right. Read the row
  against the sentence.
- A fix removes nothing from the file. It turns a row to `CHANGED`, and the
  regression test for the fix goes into the ordinary suite.
- A new feature adds its probes here *before* the review, so the reviewer reads
  outcomes rather than code.

Probes worth writing for any new engine feature — the ones the first review
found the most in:

| Ask | Why |
|---|---|
| The same failure, split in two and spaced apart | simultaneous loss and staggered loss are different documented cases |
| The failure, then the recovery, then a second failure | state that is latched, and role changes after the first |
| Every command against a member that is down or cut off | commands are answered from configuration, not from liveness |
| The same document under the other edition | gating that was written for one edition only |
| The preset's own events under both editions | presets are what a reader opens first |

### 3. A live configuration

Read-only, and only where one exists. Record the release update with every
observation.

```
DGMGRL> SHOW CONFIGURATION VERBOSE;      -- the property list of that release
DGMGRL> SHOW FAST_START FAILOVER;        -- the real spelling of every line
DGMGRL> SHOW OBSERVER;
$ strings -a $ORACLE_HOME/bin/dgmgrl | grep -c -i <PropertyName>
$ $ORACLE_HOME/OPatch/opatch lspatches
```

Anything that changes state — enabling, disabling, a role change, an `EDIT` —
is a drill, not a fact check. Those live in `testing/README.md` and need the
owner's say-so.

## The eight slices

Each slice is independent and can be handed to its own agent. Give every agent
its **own** scratch directory; shared ones get overwritten.

| # | Slice | Reads | Question |
|---|---|---|---|
| 1 | Citations A | `app/src/engine/citations.ts`, far sync to observers | Is each quote on its page, is the edition label right, does 26ai say the same, is the quote used for more than it says? |
| 2 | Citations B | `citations.ts`, fast-start failover properties to the end | Same, plus the release each property arrived in |
| 3 | Behaviour | Oracle only | What do the chapters say happens? Collected as quotes **before** reading the engine, so the engine is compared with Oracle and not the other way round |
| 4 | Defaults and tables | `engine/defaults.ts`, `engine/serialize/schema.ts`, `content/reference/*`, `content/footnotes.tsx`, `ui/inspector/*Form.tsx` | Does the property exist in that edition; default, minimum, maximum, unit; is a control greyed or offered in the wrong edition? |
| 5 | Rules and routing | `engine/validate/**`, `engine/redo/*` | Is the rule true, in which edition, at the stated severity, on the stated condition? Which documented restrictions are not checked? |
| 6 | Generated text | `engine/generate/*`, `app/test/__golden__/*`, `app/public/collectors/` | Would the script run? Is each property at the right level and in the right edition? Do the SHOW mocks spell what Oracle prints? |
| 7 | Lessons A | `content/lessons/` (clocks, transport, SYNC, application, configuration, reference), `engine/models/*`, `ui/panels/*` | Every sentence that states Oracle behaviour |
| 8 | Lessons B and presets | `content/lessons/` (far sync, cascading, observers), `ui/break`, `ui/timeline`, `ui/Readout.tsx`, `presets/*` | Same, plus: would Oracle accept each preset as drawn, under each edition? |

The engine itself (`engine/sim/*`) is reviewed by whoever coordinates: read it,
write probes, run them, and hold each outcome against slice 3.

## The report

One file at the repository root, `SIMULATOR_FACT_CHECK_<date>.md`, in the shape
of the 2026-09-28 one:

- how it was checked, and which release any live system was on;
- decisions the owner has to make before anything is fixed;
- findings, each with an id (`SIM-`, `ED-`, `VAL-`, `GEN-`, `TXT-`), severity,
  edition, reproduction, what the page shows, the Oracle sentence, and the file
  and line;
- what was checked and found correct — a review that lists only faults cannot
  be told apart from one that looked at nothing else;
- what could not be verified, and why.

Severity: **P1** an outcome Oracle documents as impossible, or something offered
that does not exist · **P2** wrong under one edition, a wrong rule, generated
text that would fail · **P3** label, wording, citation.

Ids are stable. A later review re-uses the id of a finding that is still open
and says so, rather than renumbering it.

## Traps

- **The 19c library contains later-release text.** Its fast-start failover
  chapter describes a lag limit in maximum availability and its `START OBSERVER`
  entry says four observers; its property page and a 19.27 system say
  otherwise. A sentence on a 19c page is evidence about the page. Cross-check
  the property page, the change list and, where possible, a live system.
- **Release updates backport properties the 19c pages never mention.** Three
  properties documented as new in 26ai are in the 19.27 property list.
- **Error-help pages have one tab per release.** The first tab is 26ai.
- **The 26ai pages contradict each other** — per-mode defaults against valid
  ranges, a chapter table against a property page. Report both sides; the page
  must carry a conflict label rather than pick one.
- **"New in 26ai" is often 21c.** Check the 21c change list and the 21c New
  Features guide before attributing a change.
- **Absence needs the whole page.** The 19c property and command pages are
  over 100 000 characters; a fetch that truncates them turns "not on the page"
  into a false finding.
- **A golden or a test that passes proves the code does what it did.** The
  24-cell matrix and the generator goldens pin behaviour, not truth.

## After the report

Fixes are separate work, one finding or one family at a time. Each fix changes
the citation and the test in the same commit (`AGENTS.md`, *Conventions*), moves
its probe to `CHANGED`, and — where the finding contradicted a rule written in
`AGENTS.md` or `app/design/facts.md` — corrects that rule too, so the next
reviewer is not handed the old one as fact.
