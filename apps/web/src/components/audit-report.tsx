'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Accessibility,
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileDown,
  GitCompareArrows,
  Globe2,
  ImageIcon,
  Info,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Zap,
} from 'lucide-react';
import { active, api, date, duration, host, post } from '@/lib/api';
import {
  formatMetric,
  metricValue,
  readableModule,
  resultFor,
  scoreFor,
  useAudit,
  useRunAudit,
} from '@/lib/audits';
import type { Audit, ExportJob, Finding, Result } from '@/lib/types';
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorMessage,
  Loading,
  Notice,
  PageHeading,
  Score,
  SearchBox,
  StatusBadge,
  cn,
} from './ui';
const metrics = [
  { key: 'FCP', name: 'First Contentful Paint', detail: 'When the first content becomes visible.' },
  {
    key: 'LCP',
    name: 'Largest Contentful Paint',
    detail: 'When the largest visible content renders.',
  },
  { key: 'CLS', name: 'Cumulative Layout Shift', detail: 'Visual stability during page load.' },
  { key: 'TBT', name: 'Total Blocking Time', detail: 'Time the main thread is blocked.' },
  {
    key: 'SpeedIndex',
    name: 'Speed Index',
    detail: 'How quickly the page appears visually complete.',
  },
];
export function AuditReport({ id }: { id: string }) {
  const query = useAudit(id);
  const [device, setDevice] = useState('mobile');
  const [tab, setTab] = useState('overview');
  const audit = query.data;
  const run = useRunAudit(audit?.projectId ?? '');
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorMessage error={query.error} onRetry={() => void query.refetch()} />;
  if (!audit) return null;
  const running = active(audit.status);
  const performance = resultFor(audit, 'performance', device);
  const findings = audit.findings ?? [];
  const modules = audit.results ?? [];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/dashboard' },
          {
            label: audit.project?.name ?? host(audit.targetUrl),
            href: `/projects/${audit.projectId}`,
          },
          { label: 'Audit report' },
        ]}
      />
      <PageHeading
        eyebrow="A CLOSER LOOK"
        title={audit.project?.name ?? host(audit.targetUrl)}
        description={
          <span className="report-title-info">
            <a href={audit.finalUrl ?? audit.targetUrl} target="_blank" rel="noreferrer">
              {host(audit.finalUrl ?? audit.targetUrl)}
              <ExternalLink size={12} />
            </a>
            <span>·</span>
            <span>{date(audit.createdAt)}</span>
            <StatusBadge status={audit.status} />
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/audits/${id}/compare`} variant="secondary">
              <GitCompareArrows size={15} />
              Compare
            </ButtonLink>
            <ExportButton audit={audit} />
            <Button
              variant="secondary"
              loading={run.isPending}
              disabled={running}
              onClick={() => run.mutate()}
              aria-label="Run a new audit"
            >
              <RefreshCw size={15} />
              <span className="desktop-label">Re-run</span>
            </Button>
          </>
        }
      />
      <ErrorMessage error={run.error} />
      {running ? (
        <AuditProgress audit={audit} />
      ) : audit.status === 'PARTIAL' ? (
        <div className="notice notice-partial">
          <Info size={18} />
          <div>
            <strong>There’s still a useful picture here.</strong>
            <br />
            Some checks could not finish. Completed measurements are saved below; unavailable scores
            are shown as a dash.
          </div>
        </div>
      ) : audit.status === 'FAILED' ? (
        <ErrorMessage
          error={
            new Error(
              `This audit could not complete${audit.errorCode ? ` (${audit.errorCode})` : ''}. Review the run details and try again.`,
            )
          }
        />
      ) : null}
      <div className="report-device-bar">
        <div>
          <h2>Your website, in focus.</h2>
          <p>Actual Lighthouse scores · {device === 'mobile' ? 'Mobile' : 'Desktop'} lab profile</p>
        </div>
        <DeviceSelector device={device} onChange={setDevice} />
      </div>
      <div className="report-grid">
        {[
          { module: 'performance', label: 'Performance', icon: Zap },
          { module: 'accessibility', label: 'Accessibility', icon: Accessibility },
          { module: 'seo', label: 'SEO', icon: Search },
          { module: 'bestPractices', label: 'Best practices', icon: ShieldCheck },
        ].map((m) => (
          <Card className="metric-card" key={m.module}>
            <div className="metric-top">
              <h3>{m.label}</h3>
              <m.icon size={15} />
            </div>
            <Score value={scoreFor(audit, m.module, device)} />
            <span className="muted">
              {scoreFor(audit, m.module, device) === null
                ? 'Measurement unavailable'
                : 'Lighthouse · ' + device}
            </span>
          </Card>
        ))}
      </div>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="tabs-list" aria-label="Audit report sections">
          {[
            { value: 'overview', name: 'Overview' },
            { value: 'performance', name: 'Performance' },
            { value: 'findings', name: `Issues (${findings.length})` },
            { value: 'technical', name: 'SEO, links & security' },
            { value: 'screenshots', name: 'Screenshots' },
            { value: 'details', name: 'Run details' },
          ].map((t) => (
            <Tabs.Trigger className="tab-trigger" value={t.value} key={t.value}>
              {t.name}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview">
          <div className="module-grid">
            <Card>
              <div className="card-header">
                <div>
                  <h2>Check by check.</h2>
                  <p className="card-subtitle">A transparent view of what ran and what didn’t.</p>
                </div>
                <Activity size={17} className="muted" />
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {modules.length ? (
                  modules
                    .filter((r) => r.device === 'all' || r.device === device)
                    .map((r) => (
                      <div className="service-row" key={r.id}>
                        <span>
                          {readableModule(r.module)}
                          {r.errorCode ? (
                            <span title={r.errorCode}>
                              <Info size={12} />
                            </span>
                          ) : null}
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                    ))
                ) : (
                  <p className="muted small">Your checks will appear here as they finish.</p>
                )}
              </div>
            </Card>
            <Card>
              <div className="card-header">
                <div>
                  <h2>What needs your attention.</h2>
                  <p className="card-subtitle">Start with the highest impact findings.</p>
                </div>
                <Search size={17} className="muted" />
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {['critical', 'high', 'medium', 'low', 'info'].map((s) => (
                  <div className="service-row" key={s}>
                    <StatusBadge status={s} />
                    <span className="system-value">
                      {findings.filter((f) => f.severity === s).length}
                    </span>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={() => setTab('findings')}
                >
                  Explore all findings
                  <ArrowRight size={14} />
                </Button>
              </div>
            </Card>
          </div>
          <Card className="report-summary-card">
            <div className="card-header">
              <div>
                <h2>A moment in time.</h2>
                <p className="card-subtitle">
                  This is an independent snapshot. Run another audit after making improvements.
                </p>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <dl className="detail-list">
                <dt>Inspected URL</dt>
                <dd>{audit.targetUrl}</dd>
                <dt>Final URL</dt>
                <dd>{audit.finalUrl ?? 'Not available'}</dd>
                <dt>Duration</dt>
                <dd>{duration(audit)}</dd>
                <dt>Pages saved</dt>
                <dd>{audit.pages?.length ?? 0}</dd>
                <dt>Modules completed</dt>
                <dd>
                  {modules.filter((r) => r.status === 'COMPLETED').length} of {modules.length}
                </dd>
              </dl>
            </div>
          </Card>
        </Tabs.Content>
        <Tabs.Content value="performance">
          {performance?.status !== 'COMPLETED' ? (
            <ModuleUnavailable result={performance} name={`${device} performance`} />
          ) : (
            <>
              <div className="metric-grid">
                {metrics.map((m) => (
                  <Card className="metric-number" key={m.key}>
                    <h3>{m.name}</h3>
                    <strong>{formatMetric(metricValue(performance, m.key), m.key)}</strong>
                    <p>{m.detail}</p>
                  </Card>
                ))}
              </div>
              <div className="notice" style={{ marginTop: 22 }}>
                <Info size={18} />
                <div>
                  These are Lighthouse lab measurements under a simulated device profile. Values can
                  vary with network and server conditions. INP is available only through separate
                  real-user field data.
                </div>
              </div>
              <ModuleDetails result={performance} />
            </>
          )}
          <div style={{ marginTop: 25 }}>
            <h2 style={{ fontSize: 17, marginBottom: 15 }}>Real-user field data</h2>
            {resultFor(audit, 'fieldData')?.status === 'COMPLETED' ? (
              <ModuleDetails result={resultFor(audit, 'fieldData')!} />
            ) : (
              <Card className="card-body">
                <p className="muted small">
                  {resultFor(audit, 'fieldData')?.errorCode === 'CRUX_KEY_NOT_CONFIGURED'
                    ? 'CrUX field data is optional and has not been configured for this workspace.'
                    : resultFor(audit, 'fieldData')?.errorCode === 'CRUX_NO_FIELD_DATA'
                      ? 'CrUX does not have sufficient real-user data for this URL.'
                      : 'Real-user field data is not available for this run.'}
                </p>
              </Card>
            )}
          </div>
        </Tabs.Content>
        <Tabs.Content value="findings">
          <FindingsList findings={findings} />
        </Tabs.Content>
        <Tabs.Content value="technical">
          <div className="module-grid">
            {['seo', 'http', 'security', 'links'].map((module) => (
              <Card key={module}>
                <div className="card-header">
                  <h2>{readableModule(module)}</h2>
                  {resultFor(audit, module) ? (
                    <StatusBadge status={resultFor(audit, module)!.status} />
                  ) : null}
                </div>
                <div className="card-body" style={{ paddingTop: 0 }}>
                  {resultFor(audit, module) ? (
                    <ModuleDetails result={resultFor(audit, module)!} />
                  ) : (
                    <p className="muted small">This check has not produced a result.</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
          {Boolean(audit.pages?.length) ? (
            <Card className="report-summary-card">
              <div className="card-header">
                <h2>Inspected pages</h2>
                <span className="count-pill">{audit.pages!.length}</span>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>HTTP</th>
                      <th>Response</th>
                      <th>Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.pages!.map((p) => (
                      <tr key={p.id}>
                        <td className="table-url">
                          <a href={p.url} target="_blank" rel="noreferrer">
                            {p.url}
                          </a>
                        </td>
                        <td>{p.httpStatus ?? '—'}</td>
                        <td>{p.responseTimeMs == null ? '—' : `${p.responseTimeMs} ms`}</td>
                        <td>{p.title ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </Tabs.Content>
        <Tabs.Content value="screenshots">
          <Screenshots audit={audit} />
        </Tabs.Content>
        <Tabs.Content value="details">
          <Card>
            <div className="card-header">
              <h2>About this run</h2>
              <StatusBadge status={audit.status} />
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <dl className="detail-list">
                <dt>Audit ID</dt>
                <dd className="mono">{audit.id}</dd>
                <dt>Created</dt>
                <dd>{date(audit.createdAt)}</dd>
                <dt>Started</dt>
                <dd>{date(audit.startedAt)}</dd>
                <dt>Finished</dt>
                <dd>{date(audit.finishedAt)}</dd>
                <dt>Stage</dt>
                <dd>{audit.stage}</dd>
                <dt>Error code</dt>
                <dd>{audit.errorCode ?? 'None'}</dd>
              </dl>
              <div className="divider" />
              <h3 style={{ fontSize: 13, marginBottom: 12 }}>Tool versions</h3>
              <pre className="evidence">
                {JSON.stringify(audit.toolVersionsJson ?? {}, null, 2)}
              </pre>
              <h3 style={{ fontSize: 13, margin: '20px 0 12px' }}>Audit configuration</h3>
              <pre className="evidence">{JSON.stringify(audit.configJson ?? {}, null, 2)}</pre>
            </div>
          </Card>
          <Card className="report-summary-card">
            <div className="card-header">
              <h2>Activity log</h2>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <ul className="audit-event-list">
                {audit.events?.length ? (
                  audit.events.map((e) => (
                    <li key={e.id}>
                      <time dateTime={e.createdAt}>
                        {new Date(e.createdAt).toLocaleTimeString('en', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </time>
                      <div>
                        <strong>{e.stage}</strong>
                        <br />
                        <span>{e.message}</span>
                      </div>
                    </li>
                  ))
                ) : (
                  <li>No activity events are available yet.</li>
                )}
              </ul>
            </div>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
      <p className="legal-note">
        Automated checks provide technical signals. They do not certify WCAG compliance, guarantee
        search rankings, or replace a security assessment. Scores are shown only when actual
        measurements are available.
      </p>
    </>
  );
}
function DeviceSelector({
  device,
  onChange,
}: {
  device: string;
  onChange: (device: string) => void;
}) {
  return (
    <div className="device-tabs" role="group" aria-label="Device profile">
      <button
        className={device === 'mobile' ? 'selected' : ''}
        aria-pressed={device === 'mobile'}
        onClick={() => onChange('mobile')}
      >
        <Smartphone size={13} />
        Mobile
      </button>
      <button
        className={device === 'desktop' ? 'selected' : ''}
        aria-pressed={device === 'desktop'}
        onClick={() => onChange('desktop')}
      >
        <Monitor size={14} />
        Desktop
      </button>
    </div>
  );
}
function AuditProgress({ audit }: { audit: Audit }) {
  return (
    <Card className="progress-card">
      <div className="progress-orbit">
        <Activity size={25} />
      </div>
      <div className="progress-content">
        <h2>{audit.stage}</h2>
        <p>
          {audit.status === 'QUEUED'
            ? 'Your audit is safely queued and waiting for an available worker.'
            : 'Your website is being checked. You can leave this page and return anytime.'}
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Audit progress"
          aria-valuenow={audit.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-fill" style={{ width: `${audit.progress}%` }} />
        </div>
      </div>
      <div className="progress-percent">
        {audit.progress}
        <small>%</small>
      </div>
    </Card>
  );
}
function ExportButton({ audit }: { audit: Audit }) {
  const [exportId, setExportId] = useState<string | null>(null);
  useEffect(() => {
    setExportId(localStorage.getItem(`sitescope-export-${audit.id}`));
  }, [audit.id]);
  const create = useMutation({
    mutationFn: () => post<ExportJob>(`/audits/${audit.id}/exports`),
    onSuccess: (data) => {
      setExportId(data.id);
      localStorage.setItem(`sitescope-export-${audit.id}`, data.id);
    },
  });
  const job = useQuery({
    queryKey: ['export', exportId],
    queryFn: () => api<ExportJob>(`/exports/${exportId}`),
    enabled: Boolean(exportId),
    refetchInterval: (q) => (q.state.data && active(q.state.data.status) ? 2000 : false),
  });
  const url = job.data?.url;
  const pending =
    create.isPending ||
    Boolean(exportId && (job.isPending || (job.data && active(job.data.status))));
  return (
    <div className="export-control">
      {url ? (
        <a className="button button-secondary" href={url} download>
          <Download size={15} />
          Download PDF
        </a>
      ) : (
        <Button
          variant="secondary"
          loading={pending}
          disabled={active(audit.status)}
          onClick={() => create.mutate()}
        >
          <FileDown size={15} />
          {pending ? 'Preparing PDF…' : 'Export PDF'}
        </Button>
      )}
      {create.error || job.error || job.data?.status === 'FAILED' ? (
        <div className="export-error" role="alert">
          {job.data?.status === 'FAILED'
            ? `PDF export failed (${job.data.errorCode || 'UNKNOWN'}). Click Export PDF to retry.`
            : create.error instanceof Error
              ? create.error.message
              : job.error instanceof Error
                ? job.error.message
                : 'Export failed.'}
        </div>
      ) : null}
    </div>
  );
}
export function FindingsList({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const rank = ['critical', 'high', 'medium', 'low', 'info'];
  const filtered = findings
    .filter(
      (f) =>
        (severity === 'all' || f.severity === severity) &&
        (category === 'all' || f.category === category) &&
        `${f.title} ${f.description}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity));
  return (
    <>
      <div className="section-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search findings…" />
        <select
          className="select"
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {[...new Set(findings.map((f) => f.category))].map((c) => (
            <option key={c} value={c}>
              {readableModule(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="issue-filters">
        {['all', ...rank].map((s) => (
          <button
            key={s}
            className={cn('filter-chip', severity === s && 'selected')}
            onClick={() => setSeverity(s)}
            aria-pressed={severity === s}
          >
            {s === 'all' ? 'All findings' : s[0].toUpperCase() + s.slice(1)}{' '}
            <span>
              ({s === 'all' ? findings.length : findings.filter((f) => f.severity === s).length})
            </span>
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <EmptyState
          title={
            findings.length ? 'No findings match those filters.' : 'No findings have been recorded.'
          }
          description={
            findings.length
              ? 'Try another category or search term.'
              : 'Completed automated checks found no recorded issues, or this run has not produced findings yet. Check module status for coverage.'
          }
        />
      ) : (
        <div className="findings-list">
          {filtered.map((f) => (
            <details className="finding" key={f.id}>
              <summary>
                <StatusBadge status={f.severity} />
                <h3>{f.title}</h3>
                <span className="muted small desktop-label">{readableModule(f.category)}</span>
                <ChevronRight size={16} />
              </summary>
              <div className="finding-body">
                <h4>What we found</h4>
                <p>{f.description}</p>
                <h4>A useful next step</h4>
                <p>{f.recommendation}</p>
                <h4>Evidence · {f.ruleId}</h4>
                <pre className="evidence">{JSON.stringify(f.evidenceJson, null, 2)}</pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
function ModuleUnavailable({ result, name }: { result?: Result; name: string }) {
  return (
    <Card className="card-body">
      <div className="module-status">
        <Info size={18} />
        <strong>The {name} measurement is unavailable.</strong>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        {result?.errorCode
          ? `The check reported: ${result.errorCode}. Completed checks elsewhere in this report remain available.`
          : 'The check has not completed. We won’t substitute an estimated or zero score.'}
      </p>
    </Card>
  );
}
function ModuleDetails({ result }: { result: Result }) {
  const metrics = result.metricsJson ?? {};
  const simple = Object.entries(metrics).filter(
    ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
  );
  return (
    <div>
      {result.status !== 'COMPLETED' ? (
        <div className="module-result-notice">
          <StatusBadge status={result.status} />
          <span className="muted small">{result.errorCode ?? 'No completed measurement'}</span>
        </div>
      ) : null}
      {simple.length ? (
        <dl className="detail-list">
          {simple.map(([key, value]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}</dt>
              <dd>
                {value === null
                  ? '—'
                  : typeof value === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <details className="raw-details">
        <summary>
          Inspect measured data <ChevronRight size={12} />
        </summary>
        <pre className="evidence">{JSON.stringify(metrics, null, 2)}</pre>
      </details>
      {result.rawDataJson && Object.keys(result.rawDataJson as object).length ? (
        <details className="raw-details">
          <summary>
            Raw tool output <ChevronRight size={12} />
          </summary>
          <pre className="evidence">{JSON.stringify(result.rawDataJson, null, 2)}</pre>
        </details>
      ) : null}
      <p className="muted small" style={{ marginTop: 12 }}>
        Duration: {result.durationMs.toLocaleString('en')} ms · {result.device}
      </p>
    </div>
  );
}
function Screenshots({ audit }: { audit: Audit }) {
  const screenshots =
    audit.artifacts?.filter(
      (a) => a.kind.startsWith('screenshot-') && a.mimeType.startsWith('image/'),
    ) ?? [];
  if (!screenshots.length)
    return (
      <EmptyState
        title="No screenshots for this run."
        description="Screenshots appear after the visual check completes. Check the run details if the browser stage was unavailable."
      />
    );
  return (
    <div className="screenshot-grid">
      {['desktop', 'mobile'].map((device) => {
        const a = screenshots.find((s) => s.kind === `screenshot-${device}`);
        return a ? (
          <Card key={a.id}>
            <div className="screenshot-header">
              <h3>
                {device === 'mobile' ? <Smartphone size={14} /> : <Monitor size={15} />}{' '}
                {device === 'mobile' ? 'Mobile' : 'Desktop'}
              </h3>
              <a href={a.url} target="_blank" rel="noreferrer" className="text-link small">
                Open image
                <ArrowUpRight size={13} />
              </a>
            </div>
            <div className={cn('screenshot-body', device === 'mobile' && 'screenshot-mobile')}>
              <img
                src={a.url}
                alt={`${device} screenshot of ${host(audit.targetUrl)} taken during this audit`}
                loading="lazy"
              />
            </div>
          </Card>
        ) : (
          <Card className="card-body" key={device}>
            <p className="muted small">The {device} screenshot is unavailable for this run.</p>
          </Card>
        );
      })}
    </div>
  );
}
