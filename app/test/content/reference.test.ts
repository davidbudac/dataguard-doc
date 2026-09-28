/**
 * The reference tables are data, so they can be checked as data: rectangular
 * rows, unique keys, and both editions present wherever a value differs.
 */

import { describe, expect, it } from 'vitest';
import {
  REF_TABLES, brokerProperties, byEdition, changes26ai, transportProperties,
} from '@/content/reference';
import { text } from './walk';

describe('reference tables', () => {
  it('gives every row one cell per column', () => {
    for (const t of REF_TABLES) {
      expect(t.columns.length, t.id).toBeGreaterThan(1);
      expect(t.rows.length, t.id).toBeGreaterThan(1);
      for (const r of t.rows) {
        expect(r.cells.length, `${t.id}/${r.key}`).toBe(t.columns.length);
      }
    }
  });

  it('keeps table ids and row keys unique', () => {
    const ids = REF_TABLES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of REF_TABLES) {
      const keys = t.rows.map((r) => r.key);
      expect(new Set(keys).size, t.id).toBe(keys.length);
    }
  });

  it('carries both editions where a default moved', () => {
    /* ED-01: ObserverPingRetry does not exist in 19c at all (absent from the
       12.2, 18c and 19c property pages and from a live 19.27 system) --
       never a borrowed number. */
    const pingRetry = brokerProperties.rows.find((r) => r.key === 'ping-retry');
    expect(pingRetry).toBeDefined();
    expect(pingRetry?.cells[1]).toEqual(byEdition('does not exist in 19c', '0 — not set'));
  });

  it('labels 26ai-only rows rather than hiding them', () => {
    const only = brokerProperties.rows.filter((r) => r.onlyIn === '26ai').map((r) => r.key);
    expect(only).toContain('lag-type');
    expect(only).toContain('lag-grace');
    expect(only).toContain('primary-candidates');
  });

  it('keeps NET_TIMEOUT out of the broker-properties table and in the transport one', () => {
    expect(text(brokerProperties.rows)).not.toContain('NetTimeout');
    expect(text(transportProperties.rows)).toContain('NET_TIMEOUT');
    expect(text(transportProperties.rows)).toContain('never a failover clock');
  });

  it('states the 26ai lag-limit change with its MaxAvailability default', () => {
    const row = changes26ai.rows.find((r) => r.key === 'laglimit');
    const body = text(row?.cells ?? []);
    expect(body).toContain('ZERO DATA LOSS');
    expect(body).toContain('POTENTIAL DATA LOSS');
  });
});
