import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class UrlSafetyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UrlSafetyError';
  }
}
const blockedSuffixes = [
  'localhost',
  'local',
  'internal',
  'lan',
  'home',
  'test',
  'invalid',
  'onion',
];
const blockedCidrs = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/96',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
].map((c) => ipaddr.parseCIDR(c));
export function isPublicAddress(value: string): boolean {
  try {
    const ip = ipaddr.parse(value);
    if (ip.range() !== 'unicast') return false;
    return !blockedCidrs.some(
      ([range, bits]) => ip.kind() === range.kind() && ip.match(range, bits),
    );
  } catch {
    return false;
  }
}
export function parsePublicUrl(input: string | URL): URL {
  const value = String(input);
  if (value.length > 2048)
    throw new UrlSafetyError('URL_TOO_LONG', 'URL must be at most 2048 characters.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UrlSafetyError('INVALID_URL', 'Enter a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new UrlSafetyError('UNSAFE_PROTOCOL', 'Only HTTP and HTTPS are allowed.');
  if (url.username || url.password)
    throw new UrlSafetyError('URL_CREDENTIALS', 'URLs with credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port))
    throw new UrlSafetyError('UNSAFE_PORT', 'Only ports 80 and 443 are allowed.');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    !host ||
    host.includes('%') ||
    blockedSuffixes.some((s) => host === s || host.endsWith('.' + s)) ||
    host === 'metadata.google.internal'
  )
    throw new UrlSafetyError('UNSAFE_HOST', 'Only publicly accessible hostnames are allowed.');
  if (isIP(host) && !isPublicAddress(host))
    throw new UrlSafetyError('UNSAFE_IP', 'Local, reserved and private IP addresses are blocked.');
  url.hash = '';
  return url;
}
export async function resolvePublicHost(
  hostname: string,
): Promise<{ address: string; family: number }[]> {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  let addresses: { address: string; family: number }[];
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }];
  else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new UrlSafetyError('DNS_FAILED', 'The hostname could not be resolved.');
    }
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new UrlSafetyError('UNSAFE_DNS', 'Hostname resolves to a private or reserved address.');
  return addresses;
}
export async function validatePublicUrl(input: string | URL): Promise<URL> {
  const url = parsePublicUrl(input);
  await resolvePublicHost(url.hostname);
  return url;
}
export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  durationMs: number;
  redirects: string[];
}
export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  followRedirects?: boolean;
  signal?: AbortSignal;
}
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const started = Date.now();
  const redirects: string[] = [];
  let current = parsePublicUrl(input);
  const deadline = Date.now() + (options.timeoutMs ?? 15000);
  for (let redirect = 0; redirect <= (options.maxRedirects ?? 5); redirect++) {
    options.signal?.throwIfAborted();
    const addresses = await resolvePublicHost(current.hostname);
    const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UrlSafetyError('REQUEST_TIMEOUT', 'Request timed out.');
    const response = await new Promise<Omit<SafeResponse, 'durationMs' | 'redirects'>>(
      (resolve, reject) => {
        const secure = current.protocol === 'https:';
        const request = (secure ? https : http).request(
          {
            hostname: address.address,
            family: address.family,
            port: Number(current.port) || (secure ? 443 : 80),
            path: current.pathname + current.search,
            method: options.method ?? 'GET',
            agent: false,
            ...(secure
              ? { servername: current.hostname.replace(/^\[|\]$/g, ''), rejectUnauthorized: true }
              : {}),
            headers: {
              ...options.headers,
              host: current.host,
              'user-agent': options.headers?.['user-agent'] ?? 'SiteScopeBot/1.0 (+website audit)',
              'accept-encoding': 'identity',
            },
            signal: options.signal,
          },
          (res) => {
            let total = 0;
            const chunks: Buffer[] = [];
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers[key] = Array.isArray(value) ? value.join(', ') : value;
            if (
              options.method !== 'HEAD' &&
              Number(headers['content-length']) > (options.maxBytes ?? 5_000_000)
            ) {
              res.destroy();
              request.destroy(
                new UrlSafetyError('RESPONSE_TOO_LARGE', 'Response exceeds the byte limit.'),
              );
              return;
            }
            res.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > (options.maxBytes ?? 5_000_000)) {
                request.destroy(
                  new UrlSafetyError('RESPONSE_TOO_LARGE', 'Response exceeds the byte limit.'),
                );
                res.destroy();
              } else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () =>
              resolve({
                url: current.href,
                status: res.statusCode ?? 0,
                headers,
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        const timer = setTimeout(
          () => request.destroy(new UrlSafetyError('REQUEST_TIMEOUT', 'Request timed out.')),
          remaining,
        );
        request.on('error', reject);
        request.on('close', () => clearTimeout(timer));
        request.end();
      },
    );
    if (
      options.followRedirects !== false &&
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.location
    ) {
      redirects.push(current.href);
      current = parsePublicUrl(new URL(response.headers.location, current));
      continue;
    }
    return { ...response, durationMs: Date.now() - started, redirects };
  }
  throw new UrlSafetyError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.');
}
export async function inspectTls(input: string | URL): Promise<Record<string, unknown>> {
  const url = parsePublicUrl(input);
  if (url.protocol !== 'https:') return { authorized: false, https: false };
  const addresses = await resolvePublicHost(url.hostname);
  const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: address.address,
        port: Number(url.port) || 443,
        servername: url.hostname.replace(/^\[|\]$/g, ''),
        rejectUnauthorized: true,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const value = {
          https: true,
          authorized: socket.authorized,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysRemaining: Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000),
          issuer: cert.issuer,
          subject: cert.subject,
          protocol: socket.getProtocol(),
        };
        socket.end();
        resolve(value);
      },
    );
    socket.setTimeout(10000, () =>
      socket.destroy(new UrlSafetyError('TLS_TIMEOUT', 'TLS handshake timed out.')),
    );
    socket.on('error', reject);
  });
}
