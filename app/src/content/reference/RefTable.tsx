/**
 * Reference tables as data.
 *
 * The legacy page carried the edition difference as `data-ver` attributes and
 * let CSS hide the row that did not apply. Here both editions are in the table,
 * each labelled -- nothing is hidden by CSS alone, and a printout, a
 * find-in-page and a screen reader all carry the whole reference.
 */

import type { VNode } from 'preact';
import type { Edition } from '@/engine';

export type RefValue = string | VNode;

export interface PerEdition {
  readonly perEdition: true;
  readonly '19c': RefValue;
  readonly '26ai': RefValue;
}

export type RefCell = RefValue | PerEdition;

/** Two values for one cell, one per edition. */
export const byEdition = (v19: RefValue, v26: RefValue): PerEdition => ({
  perEdition: true, '19c': v19, '26ai': v26,
});

const isPerEdition = (c: RefCell): c is PerEdition =>
  typeof c === 'object' && c !== null && (c as PerEdition).perEdition === true;

export interface RefColumn {
  key: string;
  label: string;
  /** Mono, tabular, right-hand columns: defaults, minimums, ranges. */
  numeric?: boolean;
}

export interface RefRow {
  key: string;
  /** The row describes something only one edition has. Rendered, never hidden. */
  onlyIn?: Edition;
  cells: RefCell[];
}

export interface RefTableData {
  id: string;
  title: string;
  columns: RefColumn[];
  rows: RefRow[];
}

function Cell({ cell }: { cell: RefCell }): VNode {
  if (!isPerEdition(cell)) return <>{cell}</>;
  return (
    <span class="ct-ed-pair">
      <span class="ct-ed">
        <span class="ct-ed-k">19c</span> {cell['19c']}
      </span>
      <span class="ct-ed">
        <span class="ct-ed-k">26ai</span> {cell['26ai']}
      </span>
    </span>
  );
}

export function RefTable({ data }: { data: RefTableData }): VNode {
  return (
    <div class="ct-table-wrap">
      <table class="ct-table" id={data.id}>
        <caption class="ct-table-caption">{data.title}</caption>
        <thead>
          <tr>
            {data.columns.map((c) => (
              <th key={c.key} scope="col" class={c.numeric === true ? 'ct-n' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => {
                const col = data.columns[i];
                const numeric = col !== undefined && col.numeric === true;
                return (
                  <td key={col?.key ?? String(i)} class={numeric ? 'ct-n' : undefined}>
                    {i === 0 && r.onlyIn !== undefined ? (
                      <span class="ct-chip ct-chip-edition">{r.onlyIn}</span>
                    ) : null}
                    <Cell cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
