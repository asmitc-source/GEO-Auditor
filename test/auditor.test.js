import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSite } from '../src/auditor.js';

test('auditSite returns an evidenced report for an unreachable domain', async () => {
  const report = await auditSite('https://example.invalid', { timeoutMs: 1000 });
  assert.ok(report.score <= 10);
  assert.ok(report.warnings.length > 0);
  assert.ok(report.checks.length === 3);
});
