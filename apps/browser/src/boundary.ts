import { parsePublicUrl, validatePublicUrl } from '@sitescope/core';

export async function validateBrowserDestination(input: string, proxyUrl?: string): Promise<void> {
  // An internal-only browser has no outbound DNS route. The mandatory egress
  // proxy resolves each destination, rejects private answers and pins sockets.
  // Validate syntax/IP literals here without requiring a second DNS resolver.
  if (proxyUrl) {
    const proxy = new URL(proxyUrl);
    if (proxy.protocol !== 'http:' || proxy.username || proxy.password)
      throw new Error('INVALID_EGRESS_PROXY');
    parsePublicUrl(input);
    return;
  }
  // Native development without a proxy still requires full DNS validation.
  await validatePublicUrl(input);
}
