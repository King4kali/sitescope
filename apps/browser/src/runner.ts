import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import lighthouse from 'lighthouse';
import {
  validatePublicUrl,
  type BrowserOutput,
  type FindingInput,
  type ModuleResult,
} from '@sitescope/core';

const proxyUrl = process.env.PROXY_URL ?? process.env.HTTP_PROXY;
const maxRequests = Math.min(300, Number(process.env.BROWSER_MAX_REQUESTS) || 150);
const maxBytes = Math.min(80_000_000, Number(process.env.BROWSER_MAX_BYTES) || 30_000_000);
const deviceTimeoutMs = Math.min(90_000, Number(process.env.BROWSER_DEVICE_TIMEOUT_MS) || 75_000);
const userAgent = 'SiteScopeBot/1.0 (public website audit; Chromium)';

function emptyResult(module: ModuleResult['module'], device: string, code?: string): ModuleResult {
  return {
    module,
    device,
    status: code ? 'FAILED' : 'COMPLETED',
    score: null,
    metrics: {},
    rawData: {},
    findings: [],
    errorCode: code ?? null,
    durationMs: 0,
  };
}
function code(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 100)
    : 'BROWSER_ERROR';
}

export function chromiumArguments(port?: number, profile?: string): string[] {
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--disable-quic',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-features=DnsOverHttps,MediaRouter,OptimizationHints,Translate,Prerender2,ServiceWorker',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--proxy-bypass-list=<-loopback>',
    '--js-flags=--max-old-space-size=256',
  ];
  if (port) flags.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1');
  if (profile) flags.push(`--user-data-dir=${profile}`);
  if (proxyUrl) {
    const proxy = new URL(proxyUrl);
    if (proxy.protocol !== 'http:' || proxy.username || proxy.password)
      throw new Error('INVALID_EGRESS_PROXY');
    flags.push(
      `--proxy-server=${proxy.origin}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxy.hostname}`,
    );
  } else if (process.env.NODE_ENV === 'production') throw new Error('EGRESS_PROXY_REQUIRED');
  return flags;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_DEBUGGING_PORT');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function removeProfile(profile: string): Promise<void> {
  const directory = path.resolve(profile);
  if (
    path.dirname(directory) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith('sitescope-chromium-')
  )
    throw new Error('INVALID_PROFILE_PATH');
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function chromiumEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      'PATH',
      'SystemRoot',
      'SYSTEMROOT',
      'WINDIR',
      'HOME',
      'USERPROFILE',
      'TEMP',
      'TMP',
      'TMPDIR',
      'LANG',
      'LC_ALL',
      'DISPLAY',
      'XDG_RUNTIME_DIR',
    ].flatMap((name) => (process.env[name] ? [[name, process.env[name]!]] : [])),
  );
}

interface Runtime {
  browser: Browser;
  context: BrowserContext;
  port: number;
  cleanup: () => Promise<void>;
}
async function launch(signal: AbortSignal): Promise<Runtime> {
  if (signal.aborted) throw new Error('BROWSER_TIMEOUT');
  const port = await freePort();
  const profile = await mkdtemp(path.join(tmpdir(), 'sitescope-chromium-'));
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let launchError: Error | undefined;
  const cleanup = async () => {
    signal.removeEventListener('abort', stop);
    if (browser) await Promise.race([browser.close().catch(() => undefined), delay(2000)]);
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child!.once('exit', resolve)), delay(2000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await removeProfile(profile).catch(() => undefined);
  };
  const stop = () => {
    child?.kill('SIGKILL');
  };
  try {
    // Direct launch preserves Chromium's sandbox; no --no-sandbox fallback exists.
    child = spawn(
      process.env.BROWSER_EXECUTABLE_PATH ?? chromium.executablePath(),
      [...chromiumArguments(port, profile), 'about:blank'],
      { env: chromiumEnvironment(), stdio: 'ignore', windowsHide: true },
    );
    child.once('error', (error) => {
      launchError = error;
    });
    signal.addEventListener('abort', stop, { once: true });
    for (let iteration = 0; iteration < 100; iteration += 1) {
      if (signal.aborted) throw new Error('BROWSER_TIMEOUT');
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error('CHROMIUM_START_FAILED_SANDBOX_OR_DEPENDENCY');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) break;
      } catch {
        /* Chromium may still be starting. */
      }
      await delay(100);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('NO_BROWSER_CONTEXT');
    return { browser, context, port, cleanup };
  } catch (failure) {
    await cleanup();
    throw failure;
  }
}

interface NetworkBudget {
  requests: number;
  bytes: number;
  blocked: number;
  throttled: boolean;
  exceeded: boolean;
}
async function guardContext(context: BrowserContext, stop: () => void): Promise<NetworkBudget> {
  const budget: NetworkBudget = {
    requests: 0,
    bytes: 0,
    blocked: 0,
    throttled: false,
    exceeded: false,
  };
  const enforce = () => {
    if (budget.requests > maxRequests || budget.bytes > maxBytes) {
      budget.exceeded = true;
      stop();
    }
  };
  await context.setExtraHTTPHeaders({ 'User-Agent': userAgent });
  // Lighthouse uses a default CDP context, so enforce this before site scripts.
  await context.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      Object.defineProperty(Object.getPrototypeOf(navigator.serviceWorker), 'register', {
        value: () => Promise.reject(new DOMException('Service workers are disabled during audits.', 'SecurityError')),
        writable: false,
        configurable: false,
      });
    }
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    try {
      budget.requests += 1;
      enforce();
      if (budget.exceeded || budget.throttled || !['GET', 'HEAD'].includes(request.method())) {
        budget.blocked += 1;
        await route.abort('blockedbyclient');
        return;
      }
      await validatePublicUrl(request.url());
      const redirects = (() => {
        let count = 0;
        let previous = request.redirectedFrom();
        while (previous) {
          count += 1;
          previous = previous.redirectedFrom();
        }
        return count;
      })();
      if (redirects > 5) throw new Error('REDIRECT_LIMIT');
      await route.continue();
    } catch {
      budget.blocked += 1;
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const track = async (page: Page) => {
    page.on('download', (download) => {
      void download.cancel();
    });
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
    try {
      const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.setBypassServiceWorker', { bypass: true });
      session.on('Network.loadingFinished', (event: { encodedDataLength: number }) => {
        budget.bytes += event.encodedDataLength;
        enforce();
      });
      session.on(
        'Network.responseReceived',
        (event: { response: { status: number; headers: Record<string, string> } }) => {
          if ([429, 503].includes(event.response.status)) {
            budget.throttled = true;
            stop();
          }
          const declaredLength = Number(
            Object.entries(event.response.headers).find(
              ([name]) => name.toLowerCase() === 'content-length',
            )?.[1] ?? 0,
          );
          if (declaredLength > maxBytes) {
            budget.exceeded = true;
            stop();
          }
        },
      );
    } catch {
      /* A target may close while Lighthouse prepares its next pass. */
    }
  };
  context.on('page', (page) => {
    void track(page);
  });
  await Promise.all(context.pages().map(track));
  return budget;
}

function lhFindings(
  audits: Record<
    string,
    {
      id?: string;
      title: string;
      description: string;
      score: number | null;
      scoreDisplayMode: string;
      displayValue?: string;
      details?: unknown;
    }
  >,
  url: string,
  performanceRules: Set<string>,
): FindingInput[] {
  return Object.entries(audits)
    .filter(
      ([id, item]) =>
        performanceRules.has(id) &&
        item.score !== null &&
        item.score < 0.9 &&
        ['numeric', 'binary'].includes(item.scoreDisplayMode),
    )
    .slice(0, 45)
    .map(([id, item]) => ({
      category: 'performance',
      ruleId: `lighthouse-${id}`,
      severity: item.score === 0 ? 'medium' : 'low',
      title: item.title,
      description: item.description,
      recommendation:
        'Review the Lighthouse diagnostic and verify the change against a repeat measurement.',
      evidence: {
        score: item.score,
        displayValue: item.displayValue ?? null,
        details: JSON.stringify(item.details ?? {}).slice(0, 12_000),
      },
      pageUrl: url,
    }));
}

async function measureDevice(
  url: string,
  device: 'mobile' | 'desktop',
  signal: AbortSignal,
): Promise<{
  results: ModuleResult[];
  screenshot?: BrowserOutput['screenshots'][number];
  finalUrl?: string;
}> {
  const started = Date.now();
  const abort = new AbortController();
  const deviceSignal = AbortSignal.any([
    signal,
    abort.signal,
    AbortSignal.timeout(deviceTimeoutMs),
  ]);
  const runtime = await launch(deviceSignal);
  let budget: NetworkBudget = {
    requests: 0,
    bytes: 0,
    blocked: 0,
    throttled: false,
    exceeded: false,
  };
  const outputs: ModuleResult[] = [];
  let finalUrl = url;
  let screenshot: BrowserOutput['screenshots'][number] | undefined;
  try {
    budget = await guardContext(runtime.context, () => abort.abort());
    try {
      const measured = await lighthouse(url, {
        port: runtime.port,
        hostname: '127.0.0.1',
        logLevel: 'error',
        output: 'json',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        maxWaitForLoad: 25_000,
        formFactor: device,
        screenEmulation:
          device === 'desktop'
            ? { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false }
            : { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false },
        throttling:
          device === 'desktop'
            ? {
                rttMs: 40,
                throughputKbps: 10_240,
                cpuSlowdownMultiplier: 1,
                requestLatencyMs: 0,
                downloadThroughputKbps: 0,
                uploadThroughputKbps: 0,
              }
            : undefined,
      });
      if (!measured?.lhr || measured.lhr.runtimeError)
        throw new Error(measured?.lhr.runtimeError?.code ?? 'LIGHTHOUSE_NO_RESULT');
      const lhr = measured.lhr;
      finalUrl = lhr.finalDisplayedUrl || lhr.finalUrl || url;
      const performance = emptyResult('performance', device);
      performance.score =
        lhr.categories.performance?.score == null
          ? null
          : Math.round(lhr.categories.performance.score * 100);
      performance.metrics = {
        fcp: lhr.audits['first-contentful-paint']?.numericValue ?? null,
        lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
        cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
        tbt: lhr.audits['total-blocking-time']?.numericValue ?? null,
        speedIndex: lhr.audits['speed-index']?.numericValue ?? null,
        categoryScores: Object.fromEntries(
          Object.entries(lhr.categories).map(([name, value]) => [
            name === 'best-practices' ? 'bestPractices' : name,
            value.score == null ? null : Math.round(value.score * 100),
          ]),
        ),
        environment: lhr.environment,
        fetchTime: lhr.fetchTime,
        lighthouseVersion: lhr.lighthouseVersion,
        requestedUrl: lhr.requestedUrl,
        finalUrl,
        warnings: lhr.runWarnings,
        profile: {
          formFactor: device,
          proxiedAndGuarded: Boolean(proxyUrl),
          coldStorage: true,
          maxRequests,
          maxBytes,
        },
      };
      performance.rawData = {
        audits: Object.fromEntries(
          Object.entries(lhr.audits).map(([key, value]) => [
            key,
            {
              score: value.score,
              numericValue: value.numericValue ?? null,
              title: value.title,
              displayValue: value.displayValue ?? null,
            },
          ]),
        ),
      };
      performance.findings = lhFindings(
        lhr.audits,
        finalUrl,
        new Set(lhr.categories.performance?.auditRefs.map((reference) => reference.id) ?? []),
      );
      performance.durationMs = Date.now() - started;
      outputs.push(performance);
      const accessibility = emptyResult('accessibility', device);
      accessibility.score =
        lhr.categories.accessibility?.score == null
          ? null
          : Math.round(lhr.categories.accessibility.score * 100);
      accessibility.metrics = { lighthouseScore: accessibility.score, automatedOnly: true };
      outputs.push(accessibility);
    } catch (failure) {
      outputs.push(emptyResult('performance', device, code(failure)));
    }
    if (deviceSignal.aborted || budget.exceeded || budget.throttled)
      throw new Error(
        budget.throttled
          ? 'HTTP_THROTTLED'
          : budget.exceeded
            ? 'BROWSER_BUDGET_EXCEEDED'
            : 'BROWSER_TIMEOUT',
      );
    // Fresh context shares no storage with the Lighthouse measurement.
    const context = await runtime.browser.newContext({
      viewport: device === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      isMobile: device === 'mobile',
      deviceScaleFactor: 1,
      userAgent,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const visualBudget = await guardContext(context, () => abort.abort());
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (response && response.status() >= 400)
      throw new Error(`SCREENSHOT_HTTP_${response.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await validatePublicUrl(page.url());
    finalUrl = page.url();
    const image = await page.screenshot({
      type: 'png',
      fullPage: false,
      timeout: 10_000,
      animations: 'disabled',
    });
    if (image.length < 8_000_000)
      screenshot = { device, data: image.toString('base64'), mimeType: 'image/png' };
    const axeStarted = Date.now();
    try {
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const accessibility =
        outputs.find((item) => item.module === 'accessibility') ??
        emptyResult('accessibility', device);
      accessibility.metrics = {
        ...accessibility.metrics,
        violations: axe.violations.length,
        passes: axe.passes.length,
        incomplete: axe.incomplete.length,
        inapplicable: axe.inapplicable.length,
        axeVersion: axe.testEngine.version,
        checkedAt: axe.timestamp,
        url: axe.url,
        automatedOnly: true,
      };
      accessibility.rawData = {
        violations: axe.violations.map((item) => ({
          id: item.id,
          impact: item.impact,
          help: item.help,
          helpUrl: item.helpUrl,
          tags: item.tags,
          nodes: item.nodes
            .slice(0, 20)
            .map((node) => ({
              html: node.html.slice(0, 2000),
              target: node.target,
              failureSummary: node.failureSummary,
            })),
        })),
        incomplete: axe.incomplete.map((item) => ({
          id: item.id,
          impact: item.impact,
          help: item.help,
          nodes: item.nodes.length,
        })),
      };
      accessibility.findings = axe.violations.map((item) => ({
        category: 'accessibility',
        ruleId: `axe-${item.id}`,
        severity:
          item.impact === 'critical' ? 'high' : item.impact === 'serious' ? 'medium' : 'low',
        title: item.help,
        description: item.description,
        recommendation: `Review ${item.helpUrl} and verify with keyboard and assistive technology testing.`,
        evidence: {
          impact: item.impact,
          helpUrl: item.helpUrl,
          nodes: item.nodes
            .slice(0, 10)
            .map((node) => ({
              html: node.html.slice(0, 2000),
              target: node.target,
              failureSummary: node.failureSummary,
            })),
        },
        pageUrl: finalUrl,
      }));
      accessibility.durationMs = Date.now() - axeStarted;
      if (!outputs.includes(accessibility)) outputs.push(accessibility);
    } catch (failure) {
      const existing = outputs.find((item) => item.module === 'accessibility');
      if (existing) {
        existing.status = 'FAILED';
        existing.errorCode = `AXE_${code(failure)}`;
      } else outputs.push(emptyResult('accessibility', device, code(failure)));
    }
    const performance = outputs.find((item) => item.module === 'performance');
    if (performance)
      performance.metrics.networkBudget = { lighthouse: budget, screenshotAndAxe: visualBudget };
    return { results: outputs, screenshot, finalUrl };
  } catch (failure) {
    if (!outputs.some((item) => item.module === 'performance'))
      outputs.push(emptyResult('performance', device, code(failure)));
    if (!outputs.some((item) => item.module === 'accessibility'))
      outputs.push(emptyResult('accessibility', device, code(failure)));
    else {
      const output = outputs.find((item) => item.module === 'accessibility')!;
      output.status = 'FAILED';
      output.errorCode = code(failure);
    }
    return { results: outputs, screenshot, finalUrl };
  } finally {
    await runtime.cleanup();
  }
}

export async function runBrowserAudit(url: string, signal: AbortSignal): Promise<BrowserOutput> {
  await validatePublicUrl(url);
  const output: BrowserOutput = { results: [], screenshots: [] };
  for (const device of ['mobile', 'desktop'] as const) {
    try {
      if (signal.aborted) throw new Error('BROWSER_TIMEOUT');
      const measured = await measureDevice(url, device, signal);
      output.results.push(...measured.results);
      if (measured.screenshot) output.screenshots.push(measured.screenshot);
      if (measured.finalUrl) output.finalUrl = measured.finalUrl;
    } catch (failure) {
      output.results.push(
        emptyResult('performance', device, code(failure)),
        emptyResult('accessibility', device, code(failure)),
      );
    }
  }
  const visual = emptyResult(
    'visual',
    'all',
    output.screenshots.length === 2 ? undefined : 'SCREENSHOT_INCOMPLETE',
  );
  visual.metrics = {
    captured: output.screenshots.map((item) => item.device),
    expected: ['mobile', 'desktop'],
    viewportOnly: true,
  };
  output.results.push(visual);
  return output;
}

export async function createPdf(html: string, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw new Error('PDF_TIMEOUT');
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    env: chromiumEnvironment(),
    timeout: 10_000,
    args: chromiumArguments(),
  });
  const stop = () => {
    void browser.close();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) throw new Error('PDF_TIMEOUT');
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    signal.removeEventListener('abort', stop);
    await browser.close();
  }
}
