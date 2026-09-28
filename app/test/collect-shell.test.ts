/** Exercise the real Bash wrapper with a fake SQL*Plus, not a live database. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../public/collectors/collect-dataguard.sh', import.meta.url));
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dg-collector-test-'));
  writeFileSync(join(directory, 'sqlplus'), `#!/usr/bin/env bash
printf '%s\\n' "$3" >> "$COLLECTOR_TEST_CALLS"
case "$3" in
  /@FAIL) echo 'ORA-01017: test connection failure'; exit 1;;
  /@CLIENT_ERROR) echo 'SP2-0310: test missing script'; exit 0;;
  /@INCOMPLETE) echo 'DGTOPO_BEGIN_V1'; exit 0;;
  /@SLOW) echo 'DGTOPO_BEGIN_V1'; sleep 10;;
esac
printf 'DGTOPO_BEGIN_V1\\n{"connection":"%s"}\\nDGTOPO_END_V1\\n' "$3"
`, { mode: 0o700 });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const runWith = (env: Record<string, string>, ...aliases: string[]) => spawnSync('bash', [script, ...aliases], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COLLECTOR_TEST_CALLS: join(directory, 'calls'), ...env },
});
const run = (...aliases: string[]) => runWith({}, ...aliases);

it('collects all wallet aliases in order', () => {
  const result = run('PRIMARY', 'STANDBY');
  expect(result.status).toBe(0);
  expect(result.stdout.match(/DGTOPO_END_V1/g)).toHaveLength(2);
  expect(result.stdout.indexOf('/@PRIMARY')).toBeLessThan(result.stdout.indexOf('/@STANDBY'));
});
it('uses local OS authentication without aliases', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('/ as sysdba');
});
it.each(['FAIL', 'CLIENT_ERROR', 'INCOMPLETE'])('refuses partial output after %s', alias => {
  const result = run('PRIMARY', alias);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/no import output was written/);
});
it('rejects passwords and shell syntax as aliases', () => {
  for (const alias of ['user/password@db', 'db;uname', '$(uname)']) {
    const result = run(alias);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('wallet aliases only');
  }
});
it('gives up on a connection that does not finish in time', () => {
  const result = runWith({ DG_COLLECT_TIMEOUT: '1' }, 'PRIMARY', 'SLOW');
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/did not finish within 1 s/);
  expect(result.stderr).toMatch(/no import output was written/);
});
it('rejects a malformed timeout', () => {
  const result = runWith({ DG_COLLECT_TIMEOUT: '1; uname' }, 'PRIMARY');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('DG_COLLECT_TIMEOUT');
});
