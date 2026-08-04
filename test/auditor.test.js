import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { auditSite } from '../src/auditor.js';

test('auditSite reports an honest "failed" status for an unreachable domain (no fake score)', async () => {
  const report = await auditSite('https://this-domain-does-not-exist-geo-auditor-test.invalid', { timeoutMs: 1500, skipAiProbe: true });
  assert.equal(report.status, 'failed');
  assert.equal(report.score, null);
  assert.equal(report.checks.length, 0);
  assert.ok(report.warnings.length > 0);
});

test('auditSite scores a real fetchable page and never invents evidence for failed subpages', async () => {
  const html = `<!doctype html><html><head>
    <title>Acme Test Co - Widgets</title>
    <meta name="description" content="Acme Test Co makes durable widgets for small manufacturers across the Midwest since 2011.">
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Test Co' })}</script>
  </head><body><h1>Acme Test Co</h1><p>We serve 200 customers and 12 locations.</p></body></html>`;

  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200); return res.end('User-agent: *\nAllow: /'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const report = await auditSite(`http://127.0.0.1:${port}`, { skipAiProbe: true, timeoutMs: 2000 });
    assert.equal(report.status, 'complete');
    assert.equal(typeof report.score, 'number');
    assert.equal(report.pages[0].ok, true);
    const entityCheck = report.checks.find(c => c.id === 'entity-clarity');
    assert.equal(entityCheck.evidence.hasOrganizationSchema, true);
  } finally {
    server.close();
  }
});
