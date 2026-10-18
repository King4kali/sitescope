import { setTimeout as delay } from 'node:timers/promises';

/** The runner is shared by the audit and PDF queues. Busy is backpressure, not an audit failure. */
export async function requestBrowser(
  baseUrl: string,
  endpoint: '/audit' | '/pdf',
  payload: unknown,
  signal: AbortSignal,
  maxWaitMs: number,
): Promise<Response> {
  const deadline = Date.now() + maxWaitMs;
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(maxWaitMs)]);
  const body = JSON.stringify(payload);
  while (Date.now() < deadline) {
    requestSignal.throwIfAborted();
    const response = await fetch(new URL(endpoint, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: requestSignal,
    });
    if (![429, 503].includes(response.status)) return response;
    await response.body?.cancel();
    const retryAfter = Number(response.headers.get('retry-after'));
    await delay(
      Math.max(
        500,
        Math.min(2000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500),
      ),
      undefined,
      { signal: requestSignal },
    );
  }
  throw new Error('BROWSER_BUSY_TIMEOUT');
}
