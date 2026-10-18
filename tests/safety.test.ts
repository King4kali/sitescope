import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {
  isPublicAddress,
  parsePublicUrl,
  resolvePublicHost,
  validatePublicUrl,
  safeFetch,
} from '../packages/core/src/safety.js';

test('URL parser rejects alternate loopback encodings, secrets, local hosts and unsafe ports', () => {
  for (const input of [
    'file:///etc/passwd',
    'ftp://example.com',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://localhost.',
    'http://a.localhost',
    'http://metadata.google.internal',
    'https://user:pass@example.com',
    'http://example.com:8080',
    'https://example.com/' + 'x'.repeat(2048),
  ])
    assert.throws(() => parsePublicUrl(input), input);
  assert.equal(
    parsePublicUrl('https://EXAMPLE.com:443/path#fragment').href,
    'https://example.com/path',
  );
});
test('public address classification covers reserved IPv4 and IPv6, NAT64 and mapped addresses', () => {
  for (const ip of [
    '0.0.0.0',
    '100.64.0.1',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fd00::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    '::ffff:8.8.8.8',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('DNS rejects a hostname when any resolved address is private; rechecks on every call', async (t) => {
  let calls = 0;
  t.mock.method(dns, 'lookup', async () => {
    calls++;
    return calls === 1
      ? [{ address: '8.8.8.8', family: 4 }]
      : [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ];
  });
  await validatePublicUrl('https://example.com');
  await assert.rejects(() => resolvePublicHost('example.com'), /private or reserved/);
  assert.equal(calls, 2);
});
test('safeFetch rejects a rebound private destination before opening a socket', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '169.254.169.254', family: 4 }]);
  await assert.rejects(() => safeFetch('https://example.com'), /private or reserved/);
});
