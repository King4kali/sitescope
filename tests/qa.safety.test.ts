import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import http from 'node:http';
import { safeFetch } from '../packages/core/src/safety.js';

interface Reply {
  status: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
  hang?: boolean;
}
function transport(t: TestContext, replies: Reply[]) {
  const requests: Record<string, unknown>[] = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(http, 'request', ((
    options: Record<string, unknown>,
    callback: (response: unknown) => void,
  ) => {
    requests.push(options);
    const reply = replies.shift();
    if (!reply) throw new Error('Unexpected outbound connection');
    const request = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(error?: Error): void;
    };
    let destroyed = false;
    request.destroy = (error) => {
      if (destroyed) return;
      destroyed = true;
      if (error) request.emit('error', error);
      request.emit('close');
    };
    request.end = () =>
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          headers: Record<string, string>;
          statusCode: number;
          destroy(): void;
        };
        response.headers = reply.headers ?? {};
        response.statusCode = reply.status;
        let responseDestroyed = false;
        response.destroy = () => {
          responseDestroyed = true;
        };
        callback(response);
        if (reply.hang) return;
        for (const chunk of reply.chunks ?? []) {
          if (!destroyed && !responseDestroyed) response.emit('data', chunk);
        }
        if (!destroyed && !responseDestroyed) {
          response.emit('end');
          request.emit('close');
        }
      });
    return request;
  }) as typeof http.request);
  return requests;
}

test('QA: outbound socket uses the resolved public address while retaining the intended HTTP host', async (t) => {
  const requests = transport(t, [{ status: 200, chunks: [Buffer.from('ok')] }]);
  const response = await safeFetch('http://public.example/path?q=1#fragment');
  assert.equal(response.body.toString(), 'ok');
  assert.equal(requests[0]!.hostname, '93.184.216.34');
  assert.equal(requests[0]!.family, 4);
  assert.equal(requests[0]!.path, '/path?q=1');
  assert.equal((requests[0]!.headers as Record<string, string>).host, 'public.example');
  assert.equal(requests[0]!.agent, false);
});

test('QA: a redirect to metadata is rejected before a second socket is opened', async (t) => {
  const requests = transport(t, [
    { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
  ]);
  await assert.rejects(safeFetch('http://public.example/'), { code: 'UNSAFE_IP' });
  assert.equal(requests.length, 1);
});

test('QA: redirect limit terminates a public redirect cycle', async (t) => {
  const requests = transport(t, [
    { status: 302, headers: { location: '/next' } },
    { status: 302, headers: { location: '/' } },
  ]);
  await assert.rejects(safeFetch('http://public.example/', { maxRedirects: 1 }), {
    code: 'TOO_MANY_REDIRECTS',
  });
  assert.equal(requests.length, 2);
});

test('QA: byte budget rejects declared oversize responses and streamed bodies without content-length', async (t) => {
  transport(t, [
    { status: 200, headers: { 'content-length': '100' } },
    { status: 200, chunks: [Buffer.from('123'), Buffer.from('456')] },
  ]);
  await assert.rejects(safeFetch('http://public.example/', { maxBytes: 5 }), {
    code: 'RESPONSE_TOO_LARGE',
  });
  await assert.rejects(safeFetch('http://public.example/', { maxBytes: 5 }), {
    code: 'RESPONSE_TOO_LARGE',
  });
});

test('QA: a server that opens a response and never finishes still reaches the absolute request deadline', async (t) => {
  transport(t, [{ status: 200, hang: true }]);
  const started = Date.now();
  await assert.rejects(safeFetch('http://public.example/', { timeoutMs: 10 }), {
    code: 'REQUEST_TIMEOUT',
  });
  assert.ok(Date.now() - started < 1000);
});
