import { load } from 'cheerio';
import type { FindingInput, ModuleResult } from '@sitescope/core';

export const USER_AGENT = 'SiteScopeBot/1.0 (+https://github.com/sitescope; website audit)';
export const TRACKING_KEYS = /^(utm_.+|fbclid|gclid|msclkid)$/i;

export function normalizeLink(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (TRACKING_KEYS.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}

export function result(
  module: ModuleResult['module'],
  metrics: Record<string, unknown> = {},
): ModuleResult {
  return {
    module,
    device: 'all',
    status: 'COMPLETED',
    score: null,
    metrics,
    rawData: {},
    findings: [],
    errorCode: null,
    durationMs: 0,
  };
}

export function failedResult(
  module: ModuleResult['module'],
  errorCode: string,
  device = 'all',
): ModuleResult {
  return { ...result(module), status: 'FAILED', device, errorCode };
}

export function makeFinding(
  category: string,
  ruleId: string,
  severity: FindingInput['severity'],
  title: string,
  description: string,
  recommendation: string,
  evidence: unknown,
  pageUrl?: string,
): FindingInput {
  return { category, ruleId, severity, title, description, recommendation, evidence, pageUrl };
}

export interface PageAnalysis {
  url: string;
  title: string;
  description: string;
  h1: string[];
  language: string;
  canonical: string | null;
  robots: string;
  viewport: string;
  imageCount: number;
  missingAlt: number;
  internalLinks: string[];
  links: string[];
  findings: FindingInput[];
}

export function analyzeHtml(html: string, url: string): PageAnalysis {
  const $ = load(html);
  const title = $('title').first().text().trim().slice(0, 500);
  const description =
    $('meta[name="description" i]').first().attr('content')?.trim().slice(0, 1000) ?? '';
  const h1 = $('h1')
    .toArray()
    .map((node) => $(node).text().trim().slice(0, 500));
  const language = $('html').attr('lang')?.trim() ?? '';
  const rawCanonical = $('link[rel="canonical" i]').first().attr('href');
  const canonical = rawCanonical ? normalizeLink(rawCanonical, url) : null;
  const robots = $('meta[name="robots" i]').first().attr('content') ?? '';
  const viewport = $('meta[name="viewport" i]').first().attr('content') ?? '';
  const imageCount = $('img').length;
  const missingAlt = $('img')
    .toArray()
    .filter((node) => $(node).attr('alt') === undefined).length;
  const links = [
    ...new Set(
      $('a[href]')
        .toArray()
        .map((node) => normalizeLink($(node).attr('href') ?? '', url))
        .filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, 300);
  const internalLinks = links.filter((link) => new URL(link).origin === new URL(url).origin);
  const findings: FindingInput[] = [];
  const add = (
    id: string,
    severity: FindingInput['severity'],
    heading: string,
    detail: string,
    recommendation: string,
    evidence: unknown,
  ) =>
    findings.push(makeFinding('seo', id, severity, heading, detail, recommendation, evidence, url));
  if (!title)
    add(
      'title-missing',
      'high',
      'Page title is missing',
      'The HTML document has no non-empty title.',
      'Add a unique, descriptive title for this page.',
      { title },
    );
  else if (title.length > 60)
    add(
      'title-long',
      'low',
      'Page title may be truncated',
      'The title exceeds the 60-character heuristic; display depends on the search engine.',
      'Keep the title focused and put essential information first.',
      { title, length: title.length, heuristic: 60 },
    );
  if (!description)
    add(
      'description-missing',
      'medium',
      'Meta description is missing',
      'No non-empty meta description was found.',
      'Write a useful description of this page; search engines may choose a different snippet.',
      { description },
    );
  if (h1.length !== 1)
    add(
      'h1-count',
      'medium',
      h1.length ? 'Multiple top-level headings' : 'Top-level heading is missing',
      `Found ${h1.length} H1 elements. This is a structural heuristic, not a ranking guarantee.`,
      'Use a clear primary heading and a logical heading hierarchy.',
      { h1Count: h1.length, h1 },
    );
  if (!canonical)
    add(
      'canonical-missing',
      'low',
      'Canonical URL is missing or invalid',
      'No valid HTTP(S) canonical URL was found.',
      'Declare the preferred URL when appropriate to reduce duplicate URL ambiguity.',
      { rawCanonical: rawCanonical ?? null },
    );
  if (!language)
    add(
      'language-missing',
      'medium',
      'Document language is missing',
      'The root HTML element has no language attribute.',
      'Set the lang attribute to the document language.',
      { language },
    );
  if (!viewport)
    add(
      'viewport-missing',
      'medium',
      'Mobile viewport is missing',
      'No viewport meta element was found.',
      'Add a responsive viewport and verify the mobile layout.',
      { viewport },
    );
  if (missingAlt)
    add(
      'image-alt-missing',
      'medium',
      'Images have no alt attribute',
      `${missingAlt} of ${imageCount} images omit alt. Decorative images can use an empty alt attribute.`,
      'Provide meaningful alt text for informative images and empty alt for decorative images.',
      { missingAlt, imageCount },
    );
  if (/\bnoindex\b/i.test(robots))
    add(
      'robots-noindex',
      'info',
      'Page requests no indexing',
      'A robots meta directive includes noindex.',
      'Keep noindex for intentionally excluded pages; remove it if this page should be indexed.',
      { robots },
    );
  return {
    url,
    title,
    description,
    h1,
    language,
    canonical,
    robots,
    viewport,
    imageCount,
    missingAlt,
    links,
    internalLinks,
    findings,
  };
}

export function analyzeHttp(response: {
  url: string;
  status: number;
  headers: Record<string, string>;
  durationMs: number;
  redirects: string[];
  body: Buffer;
}): ModuleResult {
  const output = result('http', {
    status: response.status,
    finalUrl: response.url,
    responseTimeMs: response.durationMs,
    redirectCount: response.redirects.length,
    redirects: response.redirects,
    contentType: response.headers['content-type'] ?? null,
    downloadedBytes: response.body.length,
  });
  output.rawData = { headers: response.headers };
  if (response.status >= 400)
    output.findings.push(
      makeFinding(
        'http',
        'http-error',
        'high',
        'The page returned an HTTP error',
        `The final response status was ${response.status}.`,
        'Check routing, origin availability and application logs.',
        { status: response.status },
        response.url,
      ),
    );
  if (response.redirects.length > 2)
    output.findings.push(
      makeFinding(
        'http',
        'redirect-chain',
        'low',
        'Long redirect chain',
        `${response.redirects.length} redirects preceded the final response.`,
        'Link directly to the canonical URL and reduce unnecessary redirects.',
        { redirects: response.redirects },
        response.url,
      ),
    );
  return output;
}

export function analyzeSecurity(
  url: string,
  headers: Record<string, string>,
  tls: Record<string, unknown> | null,
): ModuleResult {
  const names = [
    'strict-transport-security',
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ];
  const checks = Object.fromEntries(names.map((name) => [name, headers[name] ?? null]));
  const output = result('security', {
    https: new URL(url).protocol === 'https:',
    headers: checks,
    tls,
  });
  if (new URL(url).protocol !== 'https:')
    output.findings.push(
      makeFinding(
        'security',
        'https-missing',
        'high',
        'Page uses unencrypted HTTP',
        'The audited URL is served without TLS encryption.',
        'Serve the site over HTTPS and redirect HTTP traffic.',
        { url },
        url,
      ),
    );
  for (const name of names) {
    if (
      !headers[name] &&
      (name !== 'strict-transport-security' || new URL(url).protocol === 'https:')
    )
      output.findings.push(
        makeFinding(
          'security',
          `header-${name}`,
          name === 'content-security-policy' ? 'medium' : 'low',
          `Missing ${name} header`,
          'The response did not include this defense-in-depth header. Context determines the correct policy.',
          `Configure an appropriate ${name} policy and test compatibility.`,
          { header: name },
          url,
        ),
      );
  }
  if (
    !headers['x-frame-options'] &&
    !/frame-ancestors\s/i.test(headers['content-security-policy'] ?? '')
  )
    output.findings.push(
      makeFinding(
        'security',
        'frame-protection',
        'medium',
        'No framing policy found',
        'Neither CSP frame-ancestors nor X-Frame-Options was present.',
        'Restrict framing with a CSP frame-ancestors directive suited to the application.',
        {},
        url,
      ),
    );
  const expires = tls?.validTo ?? tls?.valid_to;
  if (typeof expires === 'string') {
    const days = Math.floor((new Date(expires).getTime() - Date.now()) / 86_400_000);
    if (days < 30)
      output.findings.push(
        makeFinding(
          'security',
          'tls-expiry',
          days < 0 ? 'high' : 'medium',
          'TLS certificate expires soon',
          `The certificate expires in ${days} days.`,
          'Verify automated certificate renewal and the certificate chain.',
          { expires, days },
          url,
        ),
      );
  }
  return output;
}
