import { expect, it } from 'vitest';
import { declaredPrimary, generateDgmgrl, generateInitOraFiles, renderPlain } from '@/engine';
import { classic, multiTargetThreeObservers } from '@/presets';
import { scriptsOf } from '@/ui/panels/CodeBlock';

const dgmgrl = (doc: ReturnType<typeof classic.doc>) =>
  scriptsOf(generateDgmgrl(doc, { primary: declaredPrimary(doc)! }));

it('splits the DGMGRL session into scripts that carry only commands', () => {
  const scripts = dgmgrl(classic.doc());
  expect(scripts.map((s) => s.title)).toEqual([
    'Create and enable the configuration',
    'Fast-start failover',
    'Start observer obs01 on dc3-obs01',
    'Role-based services (SRVCTL, on each database host)',
  ]);
  for (const s of scripts) expect(s.lines.every((l) => l.kind === 'cmd' || l.kind === 'blank')).toBe(true);
  // Fast-start failover pastes on its own: it opens with the session's CONNECT.
  expect(renderPlain(scripts[1]!).split('\n')[0]).toMatch(/^CONNECT sys@/);
  // The SRVCTL runbook lines are the commands of their script, without a comment marker.
  expect(renderPlain(scripts[3]!)).toMatch(/^srvctl add service -db /);
});

it('gives each observer a script of its own', () => {
  const titles = dgmgrl(multiTargetThreeObservers.doc()).map((s) => s.title);
  expect(titles.filter((t) => t.startsWith('Start observer'))).toHaveLength(3);
});

it('keeps an unsectioned file whole, without its comments', () => {
  const doc = classic.doc();
  const [file] = generateInitOraFiles(doc, { primary: declaredPrimary(doc)! });
  const [script, ...rest] = scriptsOf(file!);
  expect(rest).toEqual([]);
  expect(script!.title).toBe('LOG_ARCHIVE_DEST_n on prm01');
  expect(renderPlain(script!)).toMatch(/^log_archive_dest_2 =/);
});
