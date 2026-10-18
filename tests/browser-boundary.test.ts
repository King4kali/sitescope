import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { validateBrowserDestination } from '../apps/browser/src/boundary.js';
test('isolated proxied browser delegates DNS to the enforcing proxy while rejecting unsafe URLs', async (t) => {
  let lookups = 0;
  t.mock.method(dns, 'lookup', async () => {
    lookups++;
    throw new Error('No external DNS in the browser container');
  });
  await validateBrowserDestination('https://example.com', 'http://egress:8080');
  assert.equal(lookups, 0);
  for (const url of [
    'http://127.0.0.1',
    'http://[::1]',
    'http://169.254.169.254',
    'http://a.local',
    'https://example.com:8000',
    'file:///etc/passwd',
  ])
    await assert.rejects(() => validateBrowserDestination(url, 'http://egress:8080'));
  await assert.rejects(() =>
    validateBrowserDestination('https://example.com', 'socks5://egress:8080'),
  );
  await assert.rejects(() => validateBrowserDestination('https://example.com'));
  assert.equal(lookups, 1);
});
