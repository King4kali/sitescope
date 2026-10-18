export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export interface ReportData {
  id: string;
  targetUrl: string;
  finalUrl: string | null;
  status: string;
  createdAt: Date;
  startedAt?: Date | null;
  finishedAt: Date | null;
  configJson: unknown;
  toolVersionsJson: unknown;
  project: { name: string };
  results: {
    module: string;
    device: string;
    status: string;
    score: number | null;
    errorCode: string | null;
    metricsJson: unknown;
  }[];
  findings: {
    category: string;
    severity: string;
    title: string;
    description: string;
    recommendation: string;
    evidenceJson: unknown;
  }[];
  pages: { url: string; title: string | null; httpStatus: number | null }[];
}

export function renderReport(
  audit: ReportData,
  screenshots: { device: string; data: string }[] = [],
): string {
  const text = escapeHtml;
  const json = (value: unknown) => text(JSON.stringify(value, null, 2));
  const metricSummary = (metrics: unknown) => {
    if (!metrics || typeof metrics !== 'object') return '';
    const values = metrics as Record<string, unknown>;
    const names = [
      ['fcp', 'First Contentful Paint', 'ms'],
      ['lcp', 'Largest Contentful Paint', 'ms'],
      ['cls', 'Cumulative Layout Shift', ''],
      ['tbt', 'Total Blocking Time', 'ms'],
      ['speedIndex', 'Speed Index', 'ms'],
    ];
    const rows = names
      .filter(([key]) => key! in values)
      .map(([key, label, unit]) => {
        const value = values[key!];
        return `<tr><td>${text(label)}</td><td>${typeof value === 'number' && Number.isFinite(value) ? `${text(Number(value.toFixed(key === 'cls' ? 4 : 1)))} ${text(unit)}` : 'Unavailable'}</td></tr>`;
      })
      .join('');
    return rows
      ? `<table><thead><tr><th>Metric</th><th>Measured value</th></tr></thead><tbody>${rows}</tbody></table>`
      : '';
  };
  const images = screenshots
    .filter((item) => item.data.length < 12_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(item.data))
    .map(
      (item) =>
        `<figure><figcaption>${text(item.device)} screenshot</figcaption><img src="data:image/png;base64,${item.data}" alt="Audited page screenshot"></figure>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>SiteScope report</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:11px/1.6 Arial,sans-serif;color:#17212e}h1{font-size:30px;margin:0;color:#243f92}h2{margin-top:28px;font-size:19px;color:#243f92}h3{font-size:13px;margin-bottom:3px}p{margin:5px 0}small{color:#637086}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{padding:8px;border:1px solid #dfe5ee;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2fa}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6fa;padding:9px;font:9px/1.5 monospace}article,figure{break-inside:avoid}article{border-left:3px solid #8c99c4;padding-left:12px;margin:18px 0}.status{padding:8px 12px;background:#edf1fa;font-weight:bold}img{max-width:100%;max-height:620px;object-fit:contain}figcaption{font-weight:bold}footer{margin-top:24px;color:#637086}</style></head><body><h1>SiteScope</h1><p>Website audit report · ${text(audit.project.name)}</p><div class="status">${text(audit.status)} · ${text(audit.id)}</div><p><b>Requested:</b> ${text(audit.targetUrl)}</p><p><b>Final URL:</b> ${text(audit.finalUrl ?? 'Unavailable')}</p><p><b>Started:</b> ${text((audit.startedAt ?? audit.createdAt).toISOString())} · <b>Finished:</b> ${text(audit.finishedAt?.toISOString() ?? 'Not completed')}</p>${audit.status === 'PARTIAL' ? '<p><b>This audit is partial. Failed and skipped checks are listed explicitly below; missing scores are unavailable.</b></p>' : ''}<h2>Measured results</h2><table><thead><tr><th>Module / device</th><th>Status</th><th>Score</th><th>Error</th></tr></thead><tbody>${audit.results.map((item) => `<tr><td>${text(item.module)} / ${text(item.device)}</td><td>${text(item.status)}</td><td>${item.score === null ? 'Unavailable' : text(item.score)}</td><td>${text(item.errorCode ?? '—')}</td></tr>`).join('')}</tbody></table>${audit.results.map((item) => `<section><h3>${text(item.module)} · ${text(item.device)}</h3>${metricSummary(item.metricsJson)}<pre>${json(item.metricsJson)}</pre></section>`).join('')}<h2>Pages inspected</h2><table><thead><tr><th>URL</th><th>Title</th><th>HTTP</th></tr></thead><tbody>${audit.pages.map((item) => `<tr><td>${text(item.url)}</td><td>${text(item.title ?? 'Unavailable')}</td><td>${text(item.httpStatus ?? 'Unavailable')}</td></tr>`).join('')}</tbody></table><h2>Issues and recommendations (${audit.findings.length})</h2>${audit.findings.length ? audit.findings.map((item) => `<article><small>${text(item.severity.toUpperCase())} · ${text(item.category)}</small><h3>${text(item.title)}</h3><p>${text(item.description)}</p><p><b>Recommendation:</b> ${text(item.recommendation)}</p><pre>${json(item.evidenceJson)}</pre></article>`).join('') : '<p>No findings were recorded by the completed checks.</p>'}${images ? `<h2>Screenshots</h2>${images}` : ''}<h2>Run configuration</h2><pre>${json(audit.configJson)}</pre><h2>Tool versions</h2><pre>${json(audit.toolVersionsJson)}</pre><footer>Automated findings require context and human review. Lighthouse is a laboratory measurement, not field user data. This report is not a penetration test, an SEO guarantee, or WCAG certification.</footer></body></html>`;
}
