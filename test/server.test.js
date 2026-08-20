import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';

test('server exposes honest free-mode status and blocks private audit targets', async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const statusResponse = await fetch(`${origin}/api/status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.strictFreeMode, true);
    assert.equal(status.groq.enabled, false);
    assert.equal(status.groq.dailyLimit <= 200, true);

    const sourceResponse = await fetch(`${origin}/api/sources?q=best%20RFP%20software`);
    const sourceResult = await sourceResponse.json();
    assert.equal(sourceResponse.status, 200);
    assert.equal(sourceResult.skipped, true);

    const auditResponse = await fetch(`${origin}/api/audit?url=${encodeURIComponent(origin)}`);
    const audit = await auditResponse.json();
    assert.equal(audit.status, 'failed');
    assert.match(audit.pages[0].error, /Private-network/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (originalKey !== undefined) process.env.GROQ_API_KEY = originalKey;
  }
});
