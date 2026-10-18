'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  ExternalLink,
  FolderOpen,
  Pencil,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { active, api, date, duration, host } from '@/lib/api';
import { scoreFor, useRunAudit } from '@/lib/audits';
import type { Audit, List, Project } from '@/lib/types';
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  Label,
  Loading,
  Modal,
  PageHeading,
  Score,
  StatusBadge,
} from './ui';
import { Stat, VerificationNotice } from './dashboard';
export function ProjectDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const run = useRunAudit(id);
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Project>(`/projects/${id}`),
    refetchInterval: (q) => (q.state.data?.audits?.some((a) => active(a.status)) ? 8000 : false),
  });
  const history = useQuery({
    queryKey: ['history', id, page],
    queryFn: () => api<List<Audit>>(`/projects/${id}/audits?page=${page}&pageSize=10`),
    refetchInterval: (q) => (q.state.data?.items.some((a) => active(a.status)) ? 8000 : false),
  });
  const edit = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project', id] }),
        client.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      setRename(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: ['usage'] }),
      ]);
      router.push('/dashboard');
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorMessage error={query.error} onRetry={() => void query.refetch()} />;
  const project = query.data;
  const latest = project.audits?.[0];
  const audits = history.data?.items ?? [];
  const chart = [...(project.audits ?? [])]
    .reverse()
    .map((a) => ({
      date: date(a.createdAt, false),
      mobile: scoreFor(a, 'performance', 'mobile'),
      desktop: scoreFor(a, 'performance', 'desktop'),
    }));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', href: '/dashboard' }, { label: project.name }]} />
      <PageHeading
        eyebrow="PROJECT OVERVIEW"
        title={project.name}
        description={
          <a href={project.origin} target="_blank" rel="noreferrer" className="text-link">
            {host(project.origin)} <ExternalLink size={12} />
          </a>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setName(project.name);
                setRename(true);
              }}
            >
              <Pencil size={14} />
              Rename
            </Button>
            <Button
              loading={run.isPending}
              disabled={Boolean(latest && active(latest.status))}
              onClick={() => run.mutate()}
            >
              <RefreshCw size={14} />
              {latest ? 'Re-run audit' : 'Run first audit'}
            </Button>
          </>
        }
      />
      <VerificationNotice />
      <ErrorMessage error={run.error} />
      {latest && active(latest.status) ? (
        <div className="notice">
          <Activity className="spin" size={18} />
          <div>
            An audit is in progress: {latest.stage}.{' '}
            <Link href={`/audits/${latest.id}`} className="text-link">
              Follow progress
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      ) : null}
      <div className="stat-grid">
        <Stat
          title="Total audits"
          value={project._count?.audits ?? history.data?.total ?? '—'}
          detail="Independent, saved snapshots"
          icon={FolderOpen}
        />
        <Stat
          title="Latest mobile score"
          value={scoreFor(latest, 'performance', 'mobile') ?? '—'}
          detail="Lighthouse performance · mobile"
          icon={Zap}
        />
        <Stat
          title="Latest desktop score"
          value={scoreFor(latest, 'performance', 'desktop') ?? '—'}
          detail="Lighthouse performance · desktop"
          icon={Activity}
        />
        <Stat
          title="Last run duration"
          value={latest ? duration(latest) : '—'}
          detail={latest ? date(latest.createdAt, false) : 'No audits yet'}
          icon={Clock3}
        />
      </div>
      {chart.some((p) => p.mobile !== null || p.desktop !== null) ? (
        <Card>
          <div className="card-header">
            <div>
              <h2>Progress, over time.</h2>
              <p className="card-subtitle">
                Actual Lighthouse performance scores from your latest 20 runs.
              </p>
            </div>
            <div className="chart-legend">
              <span>
                <i />
                Mobile
              </span>
              <span>
                <i />
                Desktop
              </span>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ left: 0, right: 20, bottom: 15 }}>
                <defs>
                  <linearGradient id="mobileArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4e9a77" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4e9a77" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: 'var(--muted)' }}
                />
                <YAxis
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tick={{ fontSize: 10, fill: 'var(--muted)' }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Area
                  name="Mobile"
                  type="monotone"
                  dataKey="mobile"
                  stroke="#4e9a77"
                  fill="url(#mobileArea)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
                <Area
                  name="Desktop"
                  type="monotone"
                  dataKey="desktop"
                  stroke="#a0b674"
                  fill="transparent"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}
      <section style={{ marginTop: 27 }}>
        <div className="section-toolbar">
          <div className="section-title">
            <h2>Audit history</h2>
            {history.data ? <span className="count-pill">{history.data.total}</span> : null}
          </div>
          <span className="muted small">Every run is a separate snapshot.</span>
        </div>
        {history.isPending ? (
          <Loading count={1} />
        ) : history.error ? (
          <ErrorMessage error={history.error} onRetry={() => void history.refetch()} />
        ) : !audits.length ? (
          <EmptyState
            title="Your first insight is one audit away."
            description="Run a real audit to measure your website and discover its next improvements."
          />
        ) : (
          <Card>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run date</th>
                    <th>Status</th>
                    <th>Mobile</th>
                    <th>Desktop</th>
                    <th>Findings</th>
                    <th>Duration</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/audits/${a.id}`}>{date(a.createdAt)}</Link>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td>
                        <span className="inline-score">
                          {scoreFor(a, 'performance', 'mobile') ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span className="inline-score">
                          {scoreFor(a, 'performance', 'desktop') ?? '—'}
                        </span>
                      </td>
                      <td>{a._count?.findings ?? '—'}</td>
                      <td>{duration(a)}</td>
                      <td>
                        <ButtonLink href={`/audits/${a.id}`} variant="ghost">
                          {active(a.status) ? 'View progress' : 'View report'}
                          <ArrowUpRight size={13} />
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {history.data && history.data.total > 10 ? (
          <div className="pagination">
            <span>
              Page {page} of {Math.ceil(history.data.total / 10)}
            </span>
            <div>
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page * 10 >= history.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      <div className="project-danger">
        <p>Created {date(project.createdAt, false)} · Your project reports are private.</p>
        <button className="text-link" onClick={() => setDeleting(true)}>
          <Trash2 size={12} />
          Delete project
        </button>
      </div>
      <Modal
        open={rename}
        onOpenChange={setRename}
        title="A new name, same perspective."
        description="This changes your project’s name. Its URL and audit history remain available."
      >
        <ErrorMessage error={edit.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate();
          }}
        >
          <Label htmlFor="rename">Project name</Label>
          <Input
            id="rename"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => setRename(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={edit.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this project?"
        description="The project, its audits, screenshots, and reports will be permanently removed. This cannot be undone."
      >
        <ErrorMessage error={remove.error} />
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Keep project
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Delete project
          </Button>
        </div>
      </Modal>
    </>
  );
}
