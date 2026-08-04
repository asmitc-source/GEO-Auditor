import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditHtmlSnapshot } from '../src/auditor.js';

test('snapshot audits produce a useful scored report with fixes', async () => {
  const html = await readFile('snapshots/basecamp.html', 'utf8');
  const report = auditHtmlSnapshot('https://basecamp.com/', html);
  assert.ok(report.score >= 70);
  assert.ok(report.checks.every(check => typeof check.score === 'number'));
  assert.ok(report.fixes.length >= 1);
  assert.ok(report.warnings[0].includes('cached public-page snapshot'));
});
