import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafePublicUrl, isPrivateAddress } from '../src/urlSafety.js';

test('private and reserved addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '172.16.2.3', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', '2001:db8::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('URL safety rejects local targets and credentials', async () => {
  await assert.rejects(assertSafePublicUrl('http://127.0.0.1/admin'), /Private-network/);
  await assert.rejects(assertSafePublicUrl('https://user:pass@example.com'), /usernames or passwords/);
  const allowedFixture = await assertSafePublicUrl('http://127.0.0.1/test', { allowPrivateNetwork: true });
  assert.equal(allowedFixture.hostname, '127.0.0.1');
});
