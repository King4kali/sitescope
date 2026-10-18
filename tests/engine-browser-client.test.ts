import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestBrowser } from '../apps/worker/src/browser-client.js';

test('a PDF waits when the audit owns the browser instead of failing the export', async () => {
  let attempts = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/pdf');
    request.resume();
    attempts += 1;
    if (attempts === 1) {
      response.writeHead(429, { 'retry-after': '0.01' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-test');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await requestBrowser(
      `http://127.0.0.1:${address.port}`,
      '/pdf',
      { html: '<p>report</p>' },
      AbortSignal.timeout(3000),
      3000,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '%PDF-test');
    assert.equal(attempts, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('browser backpressure honors cancellation and never waits beyond its deadline', async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const started = Date.now();
  try {
    await assert.rejects(
      requestBrowser(
        `http://127.0.0.1:${address.port}`,
        '/audit',
        { url: 'https://example.com' },
        AbortSignal.timeout(50),
        1000,
      ),
      (error: unknown) =>
        error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name),
    );
    assert.ok(Date.now() - started < 1000);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
