import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const hopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
];
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.some((segment) => segment === '.' || segment === '..' || segment.includes('/')))
    return Response.json(
      {
        code: 'NOT_FOUND',
        message: 'This endpoint does not exist.',
        requestId: crypto.randomUUID(),
      },
      { status: 404 },
    );
  const upstream = new URL(
    `/api/v1/${path.map((segment) => encodeURIComponent(segment)).join('/')}`,
    process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000',
  );
  upstream.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  for (const key of [
    ...hopHeaders,
    'host',
    'forwarded',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-for',
  ])
    headers.delete(key);
  // Do not trust forwarded client addresses from the public request. The API applies its own proxy policy.
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = request.body;
      init.duplex = 'half';
    }
    const response = await fetch(upstream, init);
    const responseHeaders = new Headers(response.headers);
    for (const key of hopHeaders) responseHeaders.delete(key);
    if (!response.headers.get('content-type')?.includes('text/event-stream'))
      responseHeaders.set('Cache-Control', 'private, no-store');
    const cookies = response.headers.getSetCookie();
    responseHeaders.delete('set-cookie');
    for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The audit service is currently unavailable. Please try again shortly.',
        requestId: crypto.randomUUID(),
      },
      { status: 502 },
    );
  }
}
export {
  forward as GET,
  forward as POST,
  forward as PATCH,
  forward as DELETE,
  forward as PUT,
  forward as HEAD,
  forward as OPTIONS,
};
