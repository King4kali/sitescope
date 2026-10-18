import http from 'node:http';
import net from 'node:net';
import { parsePublicUrl, resolvePublicHost, safeFetch } from '@sitescope/core';

// This service is the browser's only route to the public internet. DNS is checked
// on every connection and the actual socket connects to the validated IP.
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Read-only audit proxy');
    return;
  }
  try {
    const url = parsePublicUrl(req.url ?? '');
    if (url.protocol !== 'http:') {
      res.writeHead(400).end('Use CONNECT for HTTPS');
      return;
    }
    const response = await safeFetch(url, {
      method: req.method,
      maxBytes: 10_000_000,
      timeoutMs: 30000,
      followRedirects: false,
    });
    const headers = { ...response.headers };
    for (const key of [
      'transfer-encoding',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'upgrade',
      'set-cookie',
    ])
      delete headers[key];
    headers['content-length'] = String(response.body.length);
    res.writeHead(response.status, headers);
    res.end(response.body);
  } catch {
    res
      .writeHead(502, { 'content-type': 'text/plain' })
      .end('Audit proxy denied or could not fetch the destination.');
  }
});
server.on('connect', async (req, client, head) => {
  let upstream: net.Socket | undefined;
  try {
    const url = parsePublicUrl('https://' + req.url);
    if (url.port && url.port !== '443') throw new Error('CONNECT only supports 443');
    const addresses = await resolvePublicHost(url.hostname);
    const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
    upstream = net.connect({ host: address.address, port: 443, family: address.family });
    const remote = upstream;
    const ttl = setTimeout(() => {
      remote.destroy();
      client.destroy();
    }, 90000);
    remote.setTimeout(30000, () => remote.destroy());
    remote.on('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      remote.pipe(client);
      client.pipe(remote);
    });
    let received = 0,
      sent = 0;
    remote.on('data', (data: Buffer) => {
      received += data.length;
      if (received > 35_000_000) remote.destroy();
    });
    client.on('data', (data: Buffer) => {
      sent += data.length;
      if (sent > 5_000_000) remote.destroy();
    });
    remote.on('error', () => client.destroy());
    client.on('error', () => remote.destroy());
    client.on('close', () => {
      clearTimeout(ttl);
      remote.destroy();
    });
    remote.on('close', () => {
      clearTimeout(ttl);
      client.destroy();
    });
  } catch {
    upstream?.destroy();
    client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
});
server.requestTimeout = 35000;
server.headersTimeout = 10000;
server.maxConnections = 64;
server.listen(Number(process.env.PROXY_PORT ?? 8080), '0.0.0.0', () =>
  console.log(JSON.stringify({ service: 'egress-proxy', port: 8080 })),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
