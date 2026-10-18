import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHtml,
  analyzeHttp,
  analyzeSecurity,
  normalizeLink,
} from '../apps/worker/src/rules.js';
import { escapeHtml, renderReport, type ReportData } from '../apps/worker/src/report.js';

test('HTML inspection records real metadata and missing alt without marking decorative empty alt', () => {
  const page = analyzeHtml(
    '<html lang="en"><head><title>A useful title</title><meta name="description" content="Useful summary"><meta name="viewport" content="width=device-width"><link rel="canonical" href="/home"></head><body><h1>Hello</h1><img src="a" alt=""><img src="b"><a href="/next?utm_source=test#section">Next</a><a href="javascript:alert(1)">Bad</a></body></html>',
    'https://example.com/',
  );
  assert.equal(page.title, 'A useful title');
  assert.equal(page.missingAlt, 1);
  assert.equal(page.canonical, 'https://example.com/home');
  assert.deepEqual(page.internalLinks, ['https://example.com/next']);
  assert.deepEqual(
    page.findings.map((item) => item.ruleId),
    ['image-alt-missing'],
  );
});

test('missing tags are findings, no invented score is computed', () => {
  const page = analyzeHtml(
    '<html><body><h1>One</h1><h1>Two</h1></body></html>',
    'https://example.com',
  );
  assert.ok(page.findings.some((item) => item.ruleId === 'title-missing'));
  assert.ok(page.findings.some((item) => item.ruleId === 'h1-count'));
  assert.equal(
    analyzeHttp({
      url: 'https://example.com',
      status: 503,
      headers: {},
      durationMs: 30,
      redirects: [],
      body: Buffer.from('error'),
    }).score,
    null,
  );
});

test('link normalization rejects non-web URLs and embedded credentials', () => {
  assert.equal(normalizeLink('mailto:test@example.com', 'https://example.com'), null);
  assert.equal(normalizeLink('https://user:password@example.com', 'https://example.com'), null);
  assert.equal(
    normalizeLink('../page?q=hi&gclid=abc#part', 'https://example.com/a/b'),
    'https://example.com/page?q=hi',
  );
});

test('header evidence recognizes CSP frame-ancestors and preserves TLS evidence', () => {
  const output = analyzeSecurity(
    'https://example.com',
    { 'content-security-policy': "frame-ancestors 'none'" },
    { validTo: '2100-01-01T00:00:00.000Z', authorized: true },
  );
  assert.equal(output.score, null);
  assert.ok(!output.findings.some((item) => item.ruleId === 'frame-protection'));
  assert.ok(output.findings.some((item) => item.ruleId === 'header-strict-transport-security'));
});

test('PDF template escapes audited content and marks unavailable measurements', () => {
  const payload =
    '</title><script>fetch("http://127.0.0.1")</script><img src="https://evil.example/pixel">';
  const report: ReportData = {
    id: 'audit',
    targetUrl: payload,
    finalUrl: null,
    status: 'PARTIAL',
    createdAt: new Date('2026-01-01'),
    finishedAt: null,
    configJson: { unsafe: payload },
    toolVersionsJson: {},
    project: { name: payload },
    results: [
      {
        module: 'performance',
        device: 'mobile',
        status: 'FAILED',
        score: null,
        errorCode: payload,
        metricsJson: { text: payload },
      },
    ],
    findings: [
      {
        category: 'seo',
        severity: 'high',
        title: payload,
        description: payload,
        recommendation: payload,
        evidenceJson: payload,
      },
    ],
    pages: [{ url: payload, title: payload, httpStatus: null }],
  };
  const html = renderReport(report, [{ device: payload, data: '" onerror="alert(1)' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src="https://evil'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('This audit is partial'));
  assert.ok(html.includes('Unavailable'));
  assert.ok(html.includes("default-src 'none'"));
  assert.equal(escapeHtml('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});

test('PDF labels real lowercase Lighthouse metric keys with units', () => {
  const report: ReportData = {
    id: 'audit',
    targetUrl: 'https://example.com',
    finalUrl: null,
    status: 'PARTIAL',
    createdAt: new Date('2026-01-01'),
    startedAt: new Date('2026-01-02'),
    finishedAt: null,
    configJson: {},
    toolVersionsJson: {},
    project: { name: 'Example' },
    results: [
      {
        module: 'performance',
        device: 'mobile',
        status: 'FAILED',
        score: null,
        errorCode: 'PARTIAL',
        metricsJson: { fcp: 123.4, lcp: null, cls: 0.01234 },
      },
    ],
    findings: [],
    pages: [],
  };
  const html = renderReport(report);
  assert.ok(html.includes('First Contentful Paint'));
  assert.ok(html.includes('123.4 ms'));
  assert.ok(html.includes('0.0123'));
  assert.ok(html.includes('2026-01-02T00:00:00.000Z'));
  assert.ok(html.includes('<td>Largest Contentful Paint</td><td>Unavailable</td>'));
});
