/**
 * The RedoRoutes property, edited as rules and read back as the property.
 *
 * The string under the editor is not a summary of the rules: it is
 * `formatRedoRoutes(rules)` -- the same function the DGMGRL generator calls --
 * and the text box beside it goes back the other way through
 * `parseRedoRoutes`. So whatever the reader builds here is exactly what
 * `EDIT DATABASE ... SET PROPERTY RedoRoutes` would be given, and a property
 * pasted from a live configuration comes in without being retyped.
 *
 * Two spellings round-trip, deliberately: the 12.1 `ALT=(... FALLBACK)` form
 * and the 19c/26ai `PRIORITY=n` groups. `GROUP` is not RedoRoutes syntax at
 * all -- it is a `LOG_ARCHIVE_DEST_n` attribute -- so it is not offered here.
 *
 * An empty rule list is the property at NULL, which at a database means
 * `(LOCAL : ALL)` and at a far sync instance forwards nothing.
 */

import { useState } from 'preact/hooks';
import { formatRedoRoutes, parseRedoRoutes } from '@/engine';
import type {
  DestGroup, Member, MemberId, RedoRouteRule, RoutePriority, RouteDest, TopologyDoc, XptMode,
} from '@/engine';
import { memberId } from '@/engine';
import { setRedoRoutes } from './edits';
import { Action, Group, Note } from './controls';
import { off, ON } from './why';

const PRIORITIES: RoutePriority[] = [1, 2, 3, 4, 5, 6, 7, 8];

const asPriority = (v: string): RoutePriority | undefined => {
  const n = Number(v);
  return PRIORITIES.find((p) => p === n);
};

const asXpt = (v: string): XptMode | undefined =>
  (v === 'SYNC' || v === 'FASTSYNC' || v === 'ASYNC' ? v : undefined);

/** The property as DGMGRL would print it; NULL when there are no rules. */
export const routesText = (rules: readonly RedoRouteRule[]): string =>
  (rules.length === 0 ? '' : formatRedoRoutes(rules));

export interface RedoRoutesEditorProps {
  member: Member;
  doc: TopologyDoc;
}

export function RedoRoutesEditor({ member, doc }: RedoRoutesEditorProps) {
  const rules = member.redoRoutes;
  const text = routesText(rules);
  const [error, setError] = useState<string | null>(null);
  const others = doc.members.filter((m) => m.id !== member.id);

  const commit = (next: RedoRouteRule[], label: string): void => {
    setError(null);
    setRedoRoutes(member.id, next, label);
  };

  const patchRule = (i: number, fn: (r: RedoRouteRule) => RedoRouteRule, label: string): void =>
    commit(rules.map((r, j) => (j === i ? fn(r) : r)), label);

  const patchGroup = (
    i: number, g: number, fn: (x: DestGroup) => DestGroup, label: string,
  ): void =>
    patchRule(i, (r) => ({ ...r, groups: r.groups.map((x, j) => (j === g ? fn(x) : x)) }), label);

  const patchDest = (
    i: number, g: number, d: number, fn: (x: RouteDest) => RouteDest, label: string,
  ): void =>
    patchGroup(i, g, (x) => ({ ...x, dests: x.dests.map((y, j) => (j === d ? fn(y) : y)) }), label);

  const parseText = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      commit([], `Clear RedoRoutes on ${member.id as string}`);
      return;
    }
    const res = parseRedoRoutes(trimmed);
    if (!res.ok) {
      const first = res.errors[0];
      setError(first ? `${first.message} (at character ${first.at + 1})` : 'could not be parsed');
      return;
    }
    commit(res.rules, `Set RedoRoutes on ${member.id as string}`);
  };

  return (
    <Group
      title="RedoRoutes"
      action={(
        <Action
          label="+ Rule"
          onClick={() => commit(
            [...rules, { source: 'LOCAL', groups: [{ dests: [{ target: 'ALL' }] }] }],
            `Add a RedoRoutes rule to ${member.id as string}`,
          )}
        />
      )}
    >
      <div class="field">
        <div class="field-hd">
          <span class="field-name">The property</span>
        </div>
        <input
          class="field-in rr-text"
          type="text"
          aria-label="RedoRoutes property"
          spellcheck={false}
          placeholder="(LOCAL : ALL)"
          value={text}
          onChange={(e) => parseText((e.currentTarget as HTMLInputElement).value)}
        />
        {error === null ? null : <p class="field-note is-warn">RedoRoutes: {error}</p>}
        {rules.length === 0 ? (
          <p class="field-note">
            The property is NULL. At a database that is{' '}
            <span class="mono">(LOCAL : ALL)</span>; a far sync instance with a NULL
            property forwards nothing.
          </p>
        ) : (
          <p class="field-note">
            Typed here, the property is parsed with the same grammar the generated
            DGMGRL script is printed with. Both spellings round-trip.
          </p>
        )}
      </div>

      {rules.map((rule, i) => {
        const multi = Array.isArray(rule.source) && rule.source.length > 1;
        return (
          <div class="rr-rule" key={`rule-${i}`}>
            <div class="rr-line">
              <span class="eyebrow">Rule {i + 1}</span>
              <span class="rr-spacer" />
              <Action
                label="+ Group"
                onClick={() => patchRule(
                  i,
                  (r) => ({
                    ...r,
                    groups: [...r.groups, { dests: [{ target: 'ALL' }], explicitGroup: true }],
                  }),
                  `Add a PRIORITY group on ${member.id as string}`,
                )}
              />
              <Action
                label="Remove"
                onClick={() => commit(
                  rules.filter((_, j) => j !== i),
                  `Remove a RedoRoutes rule from ${member.id as string}`,
                )}
              />
            </div>

            <label class="rr-row">
              <span class="rr-k">Source</span>
              <select
                class="field-in"
                aria-label={`Rule ${i + 1} source`}
                disabled={multi}
                value={Array.isArray(rule.source) ? (rule.source[0] as string) ?? 'LOCAL' : rule.source}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  patchRule(
                    i,
                    (r) => ({ ...r, source: v === 'LOCAL' || v === 'ANY' ? v : [memberId(v)] }),
                    `Set a RedoRoutes source on ${member.id as string}`,
                  );
                }}
              >
                <option value="LOCAL">LOCAL</option>
                <option value="ANY">ANY</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id as string}>{m.id as string}</option>
                ))}
              </select>
            </label>
            {multi ? (
              <p class="field-note">
                This rule names {(rule.source as MemberId[]).length} sources
                (<span class="mono">{(rule.source as MemberId[]).join(', ')}</span>). Edit the
                property text above to change them.
              </p>
            ) : null}

            {rule.groups.map((g, gi) => (
              <div class="rr-grp" key={`grp-${i}-${gi}`}>
                <div class="rr-row">
                  <span class="rr-k">PRIORITY</span>
                  <select
                    class="field-in"
                    aria-label={`Rule ${i + 1} group ${gi + 1} priority`}
                    value={g.priority === undefined ? '' : String(g.priority)}
                    onChange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      patchGroup(
                        i, gi,
                        (x) => {
                          const p = asPriority(v);
                          const next: DestGroup = { ...x, dests: x.dests };
                          if (p === undefined) delete next.priority;
                          else next.priority = p;
                          next.explicitGroup = p !== undefined || x.explicitGroup === true;
                          return next;
                        },
                        `Set a RedoRoutes group priority on ${member.id as string}`,
                      );
                    }}
                  >
                    <option value="">not set</option>
                    {PRIORITIES.map((p) => <option key={p} value={String(p)}>{p}</option>)}
                  </select>
                  <Action
                    label="+ Destination"
                    onClick={() => patchGroup(
                      i, gi,
                      (x) => ({ ...x, dests: [...x.dests, { target: 'ALL' }] }),
                      `Add a RedoRoutes destination on ${member.id as string}`,
                    )}
                  />
                  <Action
                    label="Remove group"
                    enabled={rule.groups.length > 1
                      ? ON
                      : off('A rule needs one group of destinations; remove the rule instead.')}
                    onClick={() => patchRule(
                      i,
                      (r) => ({ ...r, groups: r.groups.filter((_, j) => j !== gi) }),
                      `Remove a RedoRoutes group from ${member.id as string}`,
                    )}
                  />
                </div>

                {g.dests.map((d, di) => (
                  <div class="rr-dest" key={`dest-${i}-${gi}-${di}`}>
                    <select
                      class="field-in"
                      aria-label={`Rule ${i + 1} destination ${di + 1}`}
                      value={d.target === 'ALL' ? 'ALL' : (d.target as string)}
                      onChange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        patchDest(
                          i, gi, di,
                          (x) => ({ ...x, target: v === 'ALL' ? 'ALL' : memberId(v) }),
                          `Set a RedoRoutes destination on ${member.id as string}`,
                        );
                      }}
                    >
                      <option value="ALL">ALL</option>
                      {others.map((m) => (
                        <option key={m.id} value={m.id as string}>{m.id as string}</option>
                      ))}
                    </select>
                    <select
                      class="field-in"
                      aria-label={`Rule ${i + 1} destination ${di + 1} transport`}
                      value={d.xpt ?? ''}
                      onChange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        patchDest(
                          i, gi, di,
                          (x) => {
                            const next: RouteDest = { ...x };
                            const xpt = asXpt(v);
                            if (xpt === undefined) delete next.xpt;
                            else next.xpt = xpt;
                            return next;
                          },
                          `Set a RedoRoutes transport on ${member.id as string}`,
                        );
                      }}
                    >
                      <option value="">LogXptMode</option>
                      <option value="SYNC">SYNC</option>
                      <option value="FASTSYNC">FASTSYNC</option>
                      <option value="ASYNC">ASYNC</option>
                    </select>
                    <select
                      class="field-in"
                      aria-label={`Rule ${i + 1} destination ${di + 1} alternate`}
                      value={d.alt?.target ?? ''}
                      onChange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        patchDest(
                          i, gi, di,
                          (x) => {
                            const next: RouteDest = { ...x };
                            if (v === '') delete next.alt;
                            else next.alt = { ...x.alt, target: memberId(v) };
                            return next;
                          },
                          `Set a RedoRoutes alternate on ${member.id as string}`,
                        );
                      }}
                    >
                      <option value="">no ALT</option>
                      {others.map((m) => (
                        <option key={m.id} value={m.id as string}>ALT={m.id as string}</option>
                      ))}
                    </select>
                    <label class="opt">
                      <input
                        type="checkbox"
                        checked={d.alt?.fallback === true}
                        disabled={d.alt === undefined}
                        onChange={(e) => patchDest(
                          i, gi, di,
                          (x) => (x.alt === undefined
                            ? x
                            : {
                                ...x,
                                alt: {
                                  ...x.alt,
                                  fallback: (e.currentTarget as HTMLInputElement).checked,
                                },
                              }),
                          `Set FALLBACK on ${member.id as string}`,
                        )}
                      />
                      <span>FALLBACK</span>
                    </label>
                    <Action
                      label="Remove"
                      enabled={g.dests.length > 1
                        ? ON
                        : off('A group needs one destination; remove the group instead.')}
                      onClick={() => patchGroup(
                        i, gi,
                        (x) => ({ ...x, dests: x.dests.filter((_, j) => j !== di) }),
                        `Remove a RedoRoutes destination from ${member.id as string}`,
                      )}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}

      {rules.length === 0 ? null : (
        <Note>
          A rule is active only while its source names the current primary, and nothing
          rewrites RedoRoutes on a role change -- which is why the reverse rules are
          written now and sit inactive until the roles swap.
        </Note>
      )}
    </Group>
  );
}
