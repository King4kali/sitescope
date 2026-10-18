'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUp, GitCompareArrows, Minus, Smartphone } from 'lucide-react';
import { api, date } from '@/lib/api';
import { formatMetric, metricValue, resultFor, scoreFor, useAudit } from '@/lib/audits';
import type { Audit, List } from '@/lib/types';
import {
  Breadcrumbs,
  Card,
  EmptyState,
  ErrorMessage,
  Label,
  Loading,
  PageHeading,
  StatusBadge,
} from './ui';
export function CompareAudits({ id }: { id: string }) {
  const current = useAudit(id);
  const [selection, setSelection] = useState('');
  const [page, setPage] = useState(1);
  const [device, setDevice] = useState('mobile');
  const projectId = current.data?.projectId;
  const history = useQuery({
    queryKey: ['compare-history', projectId, page],
    queryFn: () => api<List<Audit>>(`/projects/${projectId}/audits?page=${page}&pageSize=50`),
    enabled: Boolean(projectId),
  });
  const candidates =
    history.data?.items.filter((a) => a.id !== id && !['QUEUED', 'RUNNING'].includes(a.status)) ??
    [];
  const previous =
    selection ||
    candidates.find((a) => current.data && a.createdAt < current.data.createdAt)?.id ||
    candidates[0]?.id;
  const compare = useQuery({
    queryKey: ['audit', previous],
    queryFn: () => api<Audit>(`/audits/${previous}/report`),
    enabled: Boolean(previous),
  });
  if (current.isPending) return <Loading />;
  if (current.error) return <ErrorMessage error={current.error} />;
  const a = current.data!;
  const b = compare.data;
  const categories = [
    ['performance', 'Performance'],
    ['accessibility', 'Accessibility'],
    ['seo', 'SEO'],
    ['bestPractices', 'Best practices'],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/dashboard' },
          { label: a.project?.name ?? 'Project', href: `/projects/${a.projectId}` },
          { label: 'Audit report', href: `/audits/${id}` },
          { label: 'Compare' },
        ]}
      />
      <PageHeading
        eyebrow="PROGRESS, IN PERSPECTIVE"
        title="See what changed."
        description="Compare two independent snapshots of the same website."
      />
      <ErrorMessage error={history.error} onRetry={() => void history.refetch()} />
      {history.isPending ? (
        <Loading count={1} />
      ) : !candidates.length ? (
        <EmptyState
          title="It takes two to see a difference."
          description="Run another audit for this project, then return here to compare measurements."
          href={`/projects/${a.projectId}`}
          action="Back to project"
        />
      ) : (
        <>
          <div className="comparison-select">
            <Card className="card-body">
              <div className="eyebrow">SELECTED AUDIT</div>
              <h3 style={{ marginBottom: 9 }}>{date(a.createdAt)}</h3>
              <StatusBadge status={a.status} />
            </Card>
            <Card className="card-body">
              <Label htmlFor="compare-audit">Compare against</Label>
              <select
                id="compare-audit"
                className="select"
                value={previous ?? ''}
                onChange={(e) => setSelection(e.target.value)}
              >
                {candidates.map((c) => (
                  <option value={c.id} key={c.id}>
                    {date(c.createdAt)} · {c.status.toLowerCase()}
                  </option>
                ))}
              </select>
              {history.data && history.data.total > 50 ? (
                <div className="pagination">
                  <span>History page {page}</span>
                  <div>
                    <button
                      className="text-link"
                      disabled={page === 1}
                      onClick={() => {
                        setPage(page - 1);
                        setSelection('');
                      }}
                    >
                      Previous
                    </button>
                    <button
                      className="text-link"
                      disabled={page * 50 >= history.data.total}
                      onClick={() => {
                        setPage(page + 1);
                        setSelection('');
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
          <div className="section-toolbar">
            <div className="section-title">
              <h2>Measurement comparison</h2>
            </div>
            <div className="device-tabs" role="group" aria-label="Comparison device">
              {['mobile', 'desktop'].map((d) => (
                <button
                  key={d}
                  className={device === d ? 'selected' : ''}
                  onClick={() => setDevice(d)}
                  aria-pressed={device === d}
                >
                  {d === 'mobile' ? 'Mobile' : 'Desktop'}
                </button>
              ))}
            </div>
          </div>
          {compare.isPending ? (
            <Loading count={2} />
          ) : compare.error ? (
            <ErrorMessage error={compare.error} onRetry={() => void compare.refetch()} />
          ) : b ? (
            <>
              <Card>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Measurement · {device}</th>
                        <th>Comparison run</th>
                        <th>Selected run</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map(([key, label]) => {
                        const av = scoreFor(a, key, device),
                          bv = scoreFor(b, key, device);
                        return (
                          <tr key={key}>
                            <td>{label}</td>
                            <td>{bv ?? '—'}</td>
                            <td>{av ?? '—'}</td>
                            <td>
                              <Delta value={av !== null && bv !== null ? av - bv : null} />
                            </td>
                          </tr>
                        );
                      })}
                      {['FCP', 'LCP', 'CLS', 'TBT', 'SpeedIndex'].map((key) => {
                        const av = metricValue(resultFor(a, 'performance', device), key),
                          bv = metricValue(resultFor(b, 'performance', device), key);
                        return (
                          <tr key={key}>
                            <td>{key === 'SpeedIndex' ? 'Speed Index' : key}</td>
                            <td>{formatMetric(bv, key)}</td>
                            <td>{formatMetric(av, key)}</td>
                            <td>
                              <Delta
                                value={
                                  typeof av === 'number' && typeof bv === 'number' ? av - bv : null
                                }
                                lowerBetter
                              />
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td>Total recorded findings</td>
                        <td>{b.findings?.length ?? '—'}</td>
                        <td>{a.findings?.length ?? '—'}</td>
                        <td>
                          <Delta
                            value={
                              a.findings && b.findings
                                ? a.findings.length - b.findings.length
                                : null
                            }
                            lowerBetter
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="module-grid" style={{ marginTop: 25 }}>
                <FindingChanges
                  title="Newly recorded findings"
                  findings={(a.findings ?? []).filter(
                    (f) => !(b.findings ?? []).some((old) => findingKey(old) === findingKey(f)),
                  )}
                />
                <FindingChanges
                  title="No longer recorded"
                  findings={(b.findings ?? []).filter(
                    (f) => !(a.findings ?? []).some((now) => findingKey(now) === findingKey(f)),
                  )}
                />
              </div>
              <p className="legal-note">
                Changes compare the selected run against the comparison run. Lower load times and
                layout shift are better; higher Lighthouse scores are better. “No longer recorded”
                can also reflect differences in completed checks or inspected pages. Lab results
                vary with network and server conditions.
              </p>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
function findingKey(f: { ruleId: string; category: string; evidenceJson: unknown }) {
  const evidence = f.evidenceJson as { pageUrl?: string; engineDevice?: string } | null;
  return `${f.ruleId}:${f.category}:${evidence?.pageUrl ?? ''}:${evidence?.engineDevice ?? ''}`;
}
function FindingChanges({
  title,
  findings,
}: {
  title: string;
  findings: { id: string; severity: string; title: string }[];
}) {
  return (
    <Card>
      <div className="card-header">
        <h2>{title}</h2>
        <span className="count-pill">{findings.length}</span>
      </div>
      <div className="card-body" style={{ paddingTop: 0 }}>
        {findings.length ? (
          findings.map((f) => (
            <div className="service-row" key={f.id}>
              <span>{f.title}</span>
              <StatusBadge status={f.severity} />
            </div>
          ))
        ) : (
          <p className="muted small">No changes in recorded findings.</p>
        )}
      </div>
    </Card>
  );
}
function Delta({ value, lowerBetter = false }: { value: number | null; lowerBetter?: boolean }) {
  if (value === null) return <span className="muted">Unavailable</span>;
  if (value === 0)
    return (
      <span className="muted">
        <Minus size={11} style={{ display: 'inline' }} /> No change
      </span>
    );
  const improved = lowerBetter ? value < 0 : value > 0;
  return (
    <span className={improved ? 'delta-good' : 'delta-bad'}>
      {value > 0 ? (
        <ArrowUp size={12} style={{ display: 'inline' }} />
      ) : (
        <ArrowDown size={12} style={{ display: 'inline' }} />
      )}{' '}
      {Math.abs(value) < 1 ? Math.abs(value).toFixed(3) : Math.abs(value).toFixed(1)}{' '}
      <small>{improved ? 'improved' : 'increased concern'}</small>
    </span>
  );
}
