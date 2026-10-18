import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Prisma, PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import {
  DEFAULT_LIMITS,
  getObject,
  putObject,
  safeFetch,
  inspectTls,
  validatePublicUrl,
  type BrowserOutput,
  type ModuleResult,
} from '@sitescope/core';
import {
  analyzeHtml,
  analyzeHttp,
  analyzeSecurity,
  failedResult,
  makeFinding,
  normalizeLink,
  result,
  USER_AGENT,
  type PageAnalysis,
} from './rules.js';
import { renderReport } from './report.js';
import { requestBrowser } from './browser-client.js';

const require = createRequire(import.meta.url);
export const db = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
const browserUrl = process.env.BROWSER_RUNNER_URL ?? 'http://127.0.0.1:4100';
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const integer = (name: string, fallback: number, ceiling: number) =>
  Math.min(ceiling, Math.max(1, Number.parseInt(process.env[name] ?? '', 10) || fallback));
const limits = {
  pages: integer('CRAWL_MAX_PAGES', DEFAULT_LIMITS.pages, 5),
  links: integer('LINK_MAX_COUNT', DEFAULT_LIMITS.links, 30),
  requestMs: integer('REQUEST_TIMEOUT_MS', 15_000, 30_000),
  auditMs: integer('AUDIT_TIMEOUT_MS', 240_000, 600_000),
  bytes: integer('AUDIT_MAX_BYTES', 20_000_000, 50_000_000),
  requestBytes: integer('REQUEST_MAX_BYTES', 5_000_000, 10_000_000),
  requests: integer('AUDIT_MAX_REQUESTS', 100, 150),
  delayMs: integer('CRAWL_DELAY_MS', 1000, 10_000),
};
export const versions = Object.fromEntries(
  ['lighthouse', 'playwright', '@axe-core/playwright', 'cheerio'].map((name) => {
    try {
      return [name, require(`${name}/package.json`).version as string];
    } catch {
      return [name, 'See package-lock.json'];
    }
  }),
);

export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const candidate = (error as Error & { code?: string }).code;
    if (candidate) return candidate.slice(0, 100);
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'TIMEOUT';
    return error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 100) || 'MODULE_ERROR';
  }
  return 'MODULE_ERROR';
}

class Cancelled extends Error {
  constructor() {
    super('CANCELLED');
  }
}
class BudgetExceeded extends Error {
  constructor() {
    super('AUDIT_BUDGET_EXCEEDED');
  }
}
export class HostBusy extends Error {
  constructor() {
    super('HOST_BUSY');
  }
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new BudgetExceeded());
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });

async function exists(auditId: string): Promise<void> {
  const audit = await db.audit.findUnique({ where: { id: auditId }, select: { status: true } });
  if (!audit || audit.status === 'CANCELLED') throw new Cancelled();
}

async function stage(
  auditId: string,
  name: string,
  progress: number,
  message: string,
): Promise<void> {
  await exists(auditId);
  await db.$transaction([
    db.audit.update({ where: { id: auditId }, data: { stage: name, progress } }),
    db.auditEvent.create({ data: { auditId, eventType: 'stage', stage: name, message } }),
  ]);
}

async function saveResult(auditId: string, output: ModuleResult): Promise<void> {
  await exists(auditId);
  const current = await db.auditResult.findUnique({
    where: { auditId_module_device: { auditId, module: output.module, device: output.device } },
  });
  // A failed redelivery cannot erase a completed measurement.
  if (current?.status === 'COMPLETED' && output.status !== 'COMPLETED') return;
  const pages = await db.auditPage.findMany({
    where: { auditId },
    select: { id: true, url: true },
  });
  await db.$transaction(async (tx) => {
    const data = {
      status: output.status,
      score: output.score,
      metricsJson: asJson(output.metrics),
      rawDataJson: asJson(output.rawData),
      errorCode: output.errorCode,
      durationMs: output.durationMs,
    };
    await tx.auditResult.upsert({
      where: { auditId_module_device: { auditId, module: output.module, device: output.device } },
      create: { auditId, module: output.module, device: output.device, ...data },
      update: data,
    });
    await tx.finding.deleteMany({
      where: {
        auditId,
        AND: [
          { evidenceJson: { path: ['engineModule'], equals: output.module } },
          { evidenceJson: { path: ['engineDevice'], equals: output.device } },
        ],
      },
    });
    if (output.findings.length)
      await tx.finding.createMany({
        data: output.findings
          .slice(0, 300)
          .map((item) => ({
            auditId,
            pageId: pages.find((page) => page.url === item.pageUrl)?.id ?? null,
            category: item.category,
            ruleId: item.ruleId.slice(0, 200),
            severity: item.severity,
            title: item.title.slice(0, 500),
            description: item.description.slice(0, 5000),
            recommendation: item.recommendation.slice(0, 5000),
            evidenceJson: asJson({
              evidence: item.evidence,
              pageUrl: item.pageUrl ?? null,
              engineModule: output.module,
              engineDevice: output.device,
            }),
          })),
      });
  });
}

type FetchResponse = Awaited<ReturnType<typeof safeFetch>>;
interface RobotsPolicy {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
}
const parseRobots = robotsParser as unknown as (url: string, content: string) => RobotsPolicy;
interface Policy {
  parser: RobotsPolicy;
  raw: string;
  status: number | null;
  error: string | null;
}

class CrawlSession {
  requests = 0;
  bytes = 0;
  stopped = false;
  private readonly deadline = Date.now() + Math.min(60_000, Math.floor(limits.auditMs / 3));
  readonly policies = new Map<string, Policy>();
  private lastRequestAt = 0;
  constructor(
    readonly signal: AbortSignal,
    readonly auditId: string,
  ) {}
  async fetch(
    url: string,
    method: 'GET' | 'HEAD' = 'GET',
    maxBytes = limits.requestBytes,
    honorRobots = true,
  ): Promise<FetchResponse> {
    const started = Date.now();
    const redirects: string[] = [];
    let current = url;
    for (let count = 0; count <= DEFAULT_LIMITS.redirects; count += 1) {
      if (honorRobots && !(await this.allowed(current))) throw new Error('ROBOTS_DISALLOWED');
      const response = await this.request(current, method, maxBytes);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        redirects.push(response.url);
        current = new URL(response.headers.location, response.url).href;
        continue;
      }
      return { ...response, redirects, durationMs: Date.now() - started };
    }
    throw new Error('TOO_MANY_REDIRECTS');
  }
  private async request(
    url: string,
    method: 'GET' | 'HEAD',
    maxBytes: number,
  ): Promise<FetchResponse> {
    if (
      this.signal.aborted ||
      this.requests >= limits.requests ||
      this.bytes >= limits.bytes ||
      this.stopped ||
      Date.now() >= this.deadline
    )
      throw new BudgetExceeded();
    await exists(this.auditId);
    await validatePublicUrl(url);
    const policy = this.policies.get(new URL(url).origin);
    const robotDelay = Math.min(10_000, (policy?.parser.getCrawlDelay(USER_AGENT) ?? 0) * 1000);
    await sleep(
      Math.max(0, this.lastRequestAt + Math.max(limits.delayMs, robotDelay) - Date.now()),
      this.signal,
    );
    this.lastRequestAt = Date.now();
    this.requests += 1;
    const response = await safeFetch(url, {
      method,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.8,*/*;q=0.1',
      },
      maxBytes: Math.min(maxBytes, limits.bytes - this.bytes),
      timeoutMs: Math.max(1, Math.min(limits.requestMs, this.deadline - Date.now())),
      followRedirects: false,
      signal: this.signal,
    });
    this.bytes += response.body.length;
    if ([429, 503].includes(response.status)) this.stopped = true;
    return response;
  }
  async robots(url: string): Promise<Policy> {
    const origin = new URL(url).origin;
    const previous = this.policies.get(origin);
    if (previous) return previous;
    const robotsUrl = new URL('/robots.txt', origin).href;
    let raw = '';
    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await this.fetch(robotsUrl, 'GET', 256_000, false);
      status = response.status;
      if (status >= 200 && status < 300) raw = response.body.toString('utf8');
      else if (status !== 404 && status !== 410) {
        raw = 'User-agent: *\nDisallow: /';
        error = `ROBOTS_HTTP_${status}`;
      }
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      // Fail closed when the robots policy cannot be obtained.
      raw = 'User-agent: *\nDisallow: /';
      error = `ROBOTS_${errorCode(failure)}`;
    }
    const policy = { parser: parseRobots(robotsUrl, raw), raw, status, error };
    this.policies.set(origin, policy);
    return policy;
  }
  async allowed(url: string): Promise<boolean> {
    const policy = await this.robots(url);
    if (policy.error) throw new Error(policy.error);
    return policy.parser.isAllowed(url, USER_AGENT) !== false;
  }
}

async function savePage(auditId: string, response: FetchResponse, analysis: PageAnalysis | null) {
  const data = {
    httpStatus: response.status,
    responseTimeMs: Math.round(response.durationMs),
    title: analysis?.title ?? null,
    metaJson: asJson(
      analysis
        ? {
            description: analysis.description,
            h1: analysis.h1,
            language: analysis.language,
            canonical: analysis.canonical,
            robots: analysis.robots,
            viewport: analysis.viewport,
            imageCount: analysis.imageCount,
            missingAlt: analysis.missingAlt,
          }
        : { contentType: response.headers['content-type'] ?? null },
    ),
  };
  await db.auditPage.upsert({
    where: { auditId_url: { auditId, url: response.url } },
    create: { auditId, url: response.url, ...data },
    update: data,
  });
}

async function crawl(
  auditId: string,
  root: FetchResponse,
  session: CrawlSession,
): Promise<{ analyses: PageAnalysis[]; links: string[] }> {
  const started = Date.now();
  const analyses: PageAnalysis[] = [];
  const issues: { url: string; error: string }[] = [];
  const rootHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(
    root.headers['content-type'] ?? '',
  );
  const rootAnalysis = rootHtml ? analyzeHtml(root.body.toString('utf8'), root.url) : null;
  await savePage(auditId, root, rootAnalysis);
  if (rootAnalysis) analyses.push(rootAnalysis);
  const policy = await session.robots(root.url);
  const sitemapUrl =
    policy.raw.match(/^sitemap:\s*(https?:\/\/\S+)/im)?.[1] ??
    new URL('/sitemap.xml', root.url).href;
  let sitemap: Record<string, unknown> = {
    url: sitemapUrl,
    status: 'SKIPPED',
    reason: 'No safe same-origin sitemap',
  };
  const sitemapPages: string[] = [];
  try {
    if (
      new URL(sitemapUrl).origin === new URL(root.url).origin &&
      (await session.allowed(sitemapUrl))
    ) {
      const response = await session.fetch(sitemapUrl, 'GET', 512_000);
      const xml = load(response.body.toString('utf8'), { xmlMode: true });
      const urls = xml('url > loc')
        .toArray()
        .map((node) => normalizeLink(xml(node).text(), root.url))
        .filter((url): url is string =>
          Boolean(url && new URL(url).origin === new URL(root.url).origin),
        );
      sitemap = {
        url: sitemapUrl,
        httpStatus: response.status,
        status: response.status === 200 ? 'COMPLETED' : 'UNAVAILABLE',
        discoveredPages: urls.length,
      };
      sitemapPages.push(...urls.slice(0, limits.pages));
    }
  } catch (failure) {
    sitemap = { url: sitemapUrl, status: 'FAILED', errorCode: errorCode(failure) };
  }
  const pending = [...new Set([...(rootAnalysis?.internalLinks ?? []), ...sitemapPages])];
  const seen = new Set([root.url]);
  for (const url of pending) {
    if (seen.size >= limits.pages || session.stopped || session.signal.aborted) break;
    if (seen.has(url) || new URL(url).origin !== new URL(root.url).origin) continue;
    seen.add(url);
    try {
      if (!(await session.allowed(url))) {
        issues.push({ url, error: 'ROBOTS_DISALLOWED' });
        continue;
      }
      const response = await session.fetch(url);
      if (new URL(response.url).origin !== new URL(root.url).origin) {
        issues.push({ url, error: 'CROSS_ORIGIN_REDIRECT_NOT_CRAWLED' });
        continue;
      }
      const analysis = /(?:text\/html|application\/xhtml\+xml)/i.test(
        response.headers['content-type'] ?? '',
      )
        ? analyzeHtml(response.body.toString('utf8'), response.url)
        : null;
      await savePage(auditId, response, analysis);
      if (analysis) {
        analyses.push(analysis);
        for (const found of analysis.internalLinks)
          if (!seen.has(found) && pending.length < 100) pending.push(found);
      }
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      issues.push({ url, error: errorCode(failure) });
    }
  }
  const output = result('seo', {
    pagesInspected: analyses.length,
    maxPages: limits.pages,
    robots: { status: policy.status, errorCode: policy.error },
    sitemap,
    crawlIssues: issues,
    pages: analyses.map(
      ({ findings: _findings, internalLinks: _internal, links: _links, ...page }) => page,
    ),
  });
  output.findings = analyses.flatMap((page) => page.findings);
  if (!rootAnalysis) {
    output.status = 'FAILED';
    output.errorCode = 'ROOT_NOT_HTML';
  } else if (
    issues.some(
      (item) => !['ROBOTS_DISALLOWED', 'CROSS_ORIGIN_REDIRECT_NOT_CRAWLED'].includes(item.error),
    )
  ) {
    output.status = 'FAILED';
    output.errorCode = 'CRAWL_PARTIAL';
  }
  if (!policy.raw && policy.status === 404)
    output.findings.push(
      makeFinding(
        'seo',
        'robots-missing',
        'info',
        'robots.txt was not found',
        'The server returned 404 for robots.txt. Crawling is allowed by default.',
        'Add robots.txt if the site needs explicit crawler instructions.',
        { status: 404 },
        root.url,
      ),
    );
  output.durationMs = Date.now() - started;
  await saveResult(auditId, output);
  return {
    analyses,
    links: [...new Set(analyses.flatMap((page) => page.links))].slice(0, limits.links),
  };
}

async function checkLinks(auditId: string, links: string[], session: CrawlSession): Promise<void> {
  const started = Date.now();
  const checks: { url: string; status: number | null; finalUrl?: string; errorCode?: string }[] =
    [];
  for (const url of links) {
    if (session.stopped || session.signal.aborted) break;
    try {
      if (!(await session.allowed(url))) {
        checks.push({ url, status: null, errorCode: 'ROBOTS_DISALLOWED' });
        continue;
      }
      let response = await session.fetch(url, 'HEAD', 4096);
      if ([405, 501].includes(response.status)) response = await session.fetch(url, 'GET', 128_000);
      checks.push({ url, status: response.status, finalUrl: response.url });
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      checks.push({ url, status: null, errorCode: errorCode(failure) });
    }
  }
  const output = result('links', {
    discovered: links.length,
    checked: checks.length,
    limit: limits.links,
    checks,
    broken: checks.filter((item) => item.status !== null && item.status >= 400).length,
    stoppedForThrottle: session.stopped,
  });
  output.findings = checks
    .filter((item) => item.status !== null && item.status >= 400)
    .map((item) =>
      makeFinding(
        'links',
        'broken-link',
        'medium',
        `Link returned HTTP ${item.status}`,
        'An HTTP error was observed while checking a discovered link.',
        'Update or remove the link; verify temporary failures before changing content.',
        item,
        item.url,
      ),
    );
  if (
    checks.length < links.length ||
    checks.some((item) => item.errorCode && item.errorCode !== 'ROBOTS_DISALLOWED')
  ) {
    output.status = 'FAILED';
    output.errorCode = 'LINK_CHECK_PARTIAL';
  }
  output.durationMs = Date.now() - started;
  await saveResult(auditId, output);
}

async function browserAudit(auditId: string, url: string, signal: AbortSignal): Promise<void> {
  const response = await requestBrowser(browserUrl, '/audit', { url, auditId }, signal, 175_000);
  if (!response.ok) throw new Error(`BROWSER_HTTP_${response.status}`);
  const payload = (await response.json()) as BrowserOutput;
  if (!Array.isArray(payload.results) || !Array.isArray(payload.screenshots))
    throw new Error('BROWSER_INVALID_OUTPUT');
  for (const output of payload.results) await saveResult(auditId, output);
  for (const screenshot of payload.screenshots) {
    if (
      !['mobile', 'desktop'].includes(screenshot.device) ||
      screenshot.mimeType !== 'image/png' ||
      screenshot.data.length > 12_000_000
    )
      continue;
    const buffer = Buffer.from(screenshot.data, 'base64');
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
    await exists(auditId);
    const storageKey = `audits/${auditId}/screenshot-${screenshot.device}.png`;
    await putObject(storageKey, buffer, 'image/png');
    await db.artifact.upsert({
      where: { storageKey },
      create: {
        auditId,
        kind: `screenshot-${screenshot.device}`,
        storageKey,
        mimeType: 'image/png',
        sizeBytes: buffer.length,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
      update: { sizeBytes: buffer.length },
    });
  }
}

async function fieldData(auditId: string, url: string, signal: AbortSignal): Promise<void> {
  const output = result('fieldData');
  if (!process.env.CRUX_API_KEY) {
    output.status = 'SKIPPED';
    output.errorCode = 'CRUX_KEY_NOT_CONFIGURED';
  } else {
    try {
      const response = await fetch(
        `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(process.env.CRUX_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        },
      );
      if (response.status === 404) {
        output.status = 'SKIPPED';
        output.errorCode = 'CRUX_NO_FIELD_DATA';
      } else if (!response.ok) throw new Error(`CRUX_HTTP_${response.status}`);
      else output.metrics = (await response.json()) as Record<string, unknown>;
    } catch (failure) {
      output.status = 'FAILED';
      output.errorCode = errorCode(failure);
    }
  }
  await saveResult(auditId, output);
}

export async function processAudit(auditId: string, attempt = 1, maxAttempts = 1): Promise<void> {
  const audit = await db.audit.findUnique({ where: { id: auditId } });
  if (!audit || ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(audit.status)) return;
  const token = randomUUID();
  const host = (await validatePublicUrl(audit.targetUrl)).hostname;
  const lockKey = `sitescope:hostname:${host}`;
  const acquired = await redis.set(lockKey, token, 'PX', limits.auditMs + 60_000, 'NX');
  if (!acquired) throw new HostBusy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.auditMs);
  const renew = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
        1,
        lockKey,
        token,
        limits.auditMs + 60_000,
      )
      .then((value) => {
        if (!value) controller.abort();
      })
      .catch(() => controller.abort());
  }, 30_000);
  renew.unref();
  let rootFetched = false;
  try {
    await db.audit.update({
      where: { id: auditId },
      data: {
        status: 'RUNNING',
        startedAt: audit.startedAt ?? new Date(),
        finishedAt: null,
        errorCode: null,
        configJson: asJson({
          limits,
          userAgent: USER_AGENT,
          devices: ['mobile', 'desktop'],
          measurement: 'Lighthouse lab; CrUX field data only when available',
        }),
        toolVersionsJson: asJson({ ...versions, node: process.version }),
      },
    });
    await stage(
      auditId,
      'Fetching website',
      0,
      'Checking robots policy and fetching the target page.',
    );
    const session = new CrawlSession(controller.signal, auditId);
    if (!(await session.allowed(audit.targetUrl))) throw new Error('ROBOTS_DISALLOWED');
    const root = await session.fetch(audit.targetUrl);
    rootFetched = true;
    await db.audit.update({ where: { id: auditId }, data: { finalUrl: root.url } });
    await saveResult(auditId, analyzeHttp(root));
    await stage(
      auditId,
      'Crawling pages',
      20,
      'Root response saved. Inspecting up to five public HTML pages.',
    );
    let links: string[] = [];
    try {
      links = (await crawl(auditId, root, session)).links;
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      await saveResult(auditId, failedResult('seo', errorCode(failure)));
    }
    await stage(
      auditId,
      'Checking links and security',
      40,
      'HTML inspection finished. Checking links, response headers and TLS.',
    );
    try {
      await checkLinks(auditId, links, session);
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      await saveResult(auditId, failedResult('links', errorCode(failure)));
    }
    try {
      const securityStarted = Date.now();
      const tls = new URL(root.url).protocol === 'https:' ? await inspectTls(root.url) : null;
      const security = analyzeSecurity(
        root.url,
        root.headers,
        tls as Record<string, unknown> | null,
      );
      security.durationMs = Date.now() - securityStarted;
      await saveResult(auditId, security);
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      await saveResult(auditId, failedResult('security', errorCode(failure)));
    }
    await stage(
      auditId,
      'Running Lighthouse',
      60,
      'HTTP checks saved. Running independent mobile and desktop browser measurements.',
    );
    try {
      if (root.status >= 400) throw new Error('BROWSER_SKIPPED_HTTP_ERROR');
      if (!(await session.allowed(root.url))) throw new Error('ROBOTS_DISALLOWED');
      await browserAudit(auditId, root.url, controller.signal);
    } catch (failure) {
      if (failure instanceof Cancelled) throw failure;
      for (const device of ['mobile', 'desktop']) {
        await saveResult(auditId, failedResult('performance', errorCode(failure), device));
        await saveResult(auditId, failedResult('accessibility', errorCode(failure), device));
      }
      await saveResult(auditId, failedResult('visual', errorCode(failure)));
    }
    await stage(
      auditId,
      'Generating report',
      90,
      'Browser checks finished. Finalizing persisted results and optional field data.',
    );
    await fieldData(auditId, root.url, controller.signal);
    await exists(auditId);
    const outputs = await db.auditResult.findMany({ where: { auditId } });
    const status = outputs.some((output) => output.status === 'FAILED') ? 'PARTIAL' : 'COMPLETED';
    await db.$transaction([
      db.audit.update({
        where: { id: auditId },
        data: {
          status,
          stage: status === 'PARTIAL' ? 'Partial' : 'Completed',
          progress: 100,
          finishedAt: new Date(),
          errorCode: status === 'PARTIAL' ? 'MODULE_FAILURES' : null,
        },
      }),
      db.auditEvent.create({
        data: {
          auditId,
          eventType: 'finished',
          stage: status,
          message:
            status === 'PARTIAL'
              ? 'Results saved; some modules could not complete.'
              : 'All available checks completed and results were saved.',
        },
      }),
    ]);
  } catch (failure) {
    if (
      failure instanceof Cancelled ||
      (await db.audit.count({ where: { id: auditId, status: { not: 'CANCELLED' } } })) === 0
    )
      return;
    const code = errorCode(failure);
    const transient =
      !rootFetched &&
      /TIMEOUT|ECONN|EAI_AGAIN|ETIMEDOUT|ENOTFOUND|DNS_FAILED|HTTP_429|HTTP_503|HOST_BUSY/.test(
        code,
      );
    if (transient && attempt < maxAttempts) {
      await db.audit.updateMany({
        where: { id: auditId, status: { not: 'CANCELLED' } },
        data: { status: 'QUEUED', stage: 'Retrying', errorCode: code },
      });
      throw failure;
    }
    if (rootFetched) {
      const available = await db.auditResult.findMany({
        where: { auditId },
        select: { module: true, device: true },
      });
      const expected: [ModuleResult['module'], string][] = [
        ['seo', 'all'],
        ['links', 'all'],
        ['security', 'all'],
        ['performance', 'mobile'],
        ['performance', 'desktop'],
        ['accessibility', 'mobile'],
        ['accessibility', 'desktop'],
        ['visual', 'all'],
        ['fieldData', 'all'],
      ];
      for (const [module, device] of expected) {
        if (!available.some((output) => output.module === module && output.device === device)) {
          const output = failedResult(module, code, device);
          if (module === 'fieldData' && !process.env.CRUX_API_KEY) {
            output.status = 'SKIPPED';
            output.errorCode = 'CRUX_KEY_NOT_CONFIGURED';
          }
          await saveResult(auditId, output);
        }
      }
    }
    await db.audit.updateMany({
      where: { id: auditId, status: { not: 'CANCELLED' } },
      data: {
        status: rootFetched ? 'PARTIAL' : 'FAILED',
        stage: rootFetched ? 'Partial' : 'Failed',
        progress: rootFetched ? 100 : 0,
        errorCode: code,
        finishedAt: new Date(),
      },
    });
    await db.auditEvent
      .create({
        data: {
          auditId,
          eventType: 'finished',
          stage: rootFetched ? 'PARTIAL' : 'FAILED',
          message: code,
        },
      })
      .catch(() => undefined);
  } finally {
    clearTimeout(timer);
    clearInterval(renew);
    await redis
      .eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      )
      .catch(() => undefined);
  }
}

export async function processReport(exportId: string, attempt = 1, maxAttempts = 1): Promise<void> {
  const record = await db.export.findUnique({
    where: { id: exportId },
    include: {
      audit: {
        include: { project: true, results: true, findings: true, pages: true, artifacts: true },
      },
    },
  });
  if (!record || record.status === 'COMPLETED') return;
  if (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(record.audit.status))
    throw new Error('AUDIT_NOT_FINISHED');
  await db.export.update({ where: { id: exportId }, data: { status: 'RUNNING', errorCode: null } });
  try {
    const screenshots: { device: string; data: string }[] = [];
    for (const artifact of record.audit.artifacts
      .filter(
        (item) =>
          item.kind.startsWith('screenshot-') &&
          item.mimeType === 'image/png' &&
          item.sizeBytes < 8_000_000,
      )
      .slice(0, 2)) {
      try {
        const object = await getObject(artifact.storageKey);
        screenshots.push({
          device: artifact.kind.replace('screenshot-', ''),
          data: object.body.toString('base64'),
        });
      } catch {
        /* A missing screenshot must not destroy the report. */
      }
    }
    const html = renderReport(record.audit, screenshots);
    const response = await requestBrowser(
      browserUrl,
      '/pdf',
      { html },
      AbortSignal.timeout(230_000),
      225_000,
    );
    if (!response.ok) throw new Error(`PDF_HTTP_${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 20_000_000 || !body.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new Error('INVALID_PDF');
    const current = await db.export.findUnique({ where: { id: exportId } });
    if (!current) return;
    const storageKey = `audits/${record.auditId}/exports/${exportId}.pdf`;
    await putObject(storageKey, body, 'application/pdf');
    await db.$transaction([
      db.export.update({
        where: { id: exportId },
        data: { status: 'COMPLETED', storageKey, errorCode: null },
      }),
      db.artifact.upsert({
        where: { storageKey },
        create: {
          auditId: record.auditId,
          kind: 'pdf',
          storageKey,
          mimeType: 'application/pdf',
          sizeBytes: body.length,
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
        update: { sizeBytes: body.length },
      }),
    ]);
  } catch (failure) {
    const code = errorCode(failure);
    const retry =
      attempt < maxAttempts &&
      /TIMEOUT|ECONN|EAI_AGAIN|HTTP_429|HTTP_5\d\d|BROWSER_BUSY|SlowDown|ServiceUnavailable/.test(
        code,
      );
    await db.export.updateMany({
      where: { id: exportId },
      data: { status: retry ? 'QUEUED' : 'FAILED', errorCode: code },
    });
    if (retry) throw failure;
  }
}
