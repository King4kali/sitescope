'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Globe2,
  Lightbulb,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { active, api, date, host, post, useUser } from '@/lib/api';
import { scoreFor, useRunAudit } from '@/lib/audits';
import type { List, Project } from '@/lib/types';
import {
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
} from './ui';
export type Usage = {
  projects: number;
  maxProjects: number;
  auditsToday: number;
  auditsPerDay: number;
  activeAudits: number;
  resetsAt: string;
};
export function VerificationNotice() {
  const user = useUser();
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user.data || user.data.user.emailVerifiedAt) return null;
  return (
    <>
      <div className="notice">
        <ShieldCheck size={18} />
        <div>
          <strong>One quick step before your first audit.</strong>
          <br />
          {sent ? (
            'A new verification email is on its way. Check your inbox.'
          ) : (
            <>
              Confirm your email using the link in your inbox.{' '}
              <button
                className="text-link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await post('/auth/resend-verification');
                    setSent(true);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Sending…' : 'Resend email'}
              </button>
            </>
          )}
        </div>
      </div>
      <ErrorMessage error={error} />
    </>
  );
}
function ProjectCard({ project }: { project: Project }) {
  const audit = project.audits?.[0];
  const run = useRunAudit(project.id);
  return (
    <article className="card project-card">
      <div className="project-top">
        <span className="site-icon">
          <Globe2 size={21} />
        </span>
        <div className="project-title">
          <h3>
            <Link href={`/projects/${project.id}`}>{project.name}</Link>
          </h3>
          <p>{host(project.origin)}</p>
        </div>
        {audit ? <StatusBadge status={audit.status} /> : <span className="badge">Not audited</span>}
      </div>
      <div className="project-scores">
        {[
          { module: 'performance', label: 'Performance' },
          { module: 'accessibility', label: 'Accessibility' },
          { module: 'seo', label: 'SEO' },
          { module: 'bestPractices', label: 'Best practices' },
        ].map((s) => (
          <Score key={s.module} value={scoreFor(audit, s.module)} label={s.label} small />
        ))}
      </div>
      <div className="project-footer">
        <div className="last-audit">
          <span>LAST AUDIT</span>
          {audit ? date(audit.createdAt, false) : 'Ready when you are'}
        </div>
        {audit && active(audit.status) ? (
          <ButtonLink href={`/audits/${audit.id}`} variant="secondary">
            View progress
            <ArrowRight size={13} />
          </ButtonLink>
        ) : audit ? (
          <ButtonLink href={`/audits/${audit.id}`} variant="secondary">
            View report
            <ArrowUpRight size={13} />
          </ButtonLink>
        ) : (
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            <Zap size={13} />
            Run audit
          </Button>
        )}
      </div>
      <div className="project-quick-links">
        <Link href={`/projects/${project.id}`}>
          Project details <ArrowRight size={12} />
        </Link>
        {audit && !active(audit.status) ? (
          <button disabled={run.isPending} onClick={() => run.mutate()}>
            <RefreshCw size={11} />
            Re-run audit
          </button>
        ) : null}
      </div>
      <ErrorMessage error={run.error} />
    </article>
  );
}
export function Dashboard() {
  const t = useTranslations('common');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updatedAt');
  const [page, setPage] = useState(1);
  const user = useUser();
  const query = useQuery({
    queryKey: ['projects', search, sort, page],
    queryFn: () =>
      api<List<Project>>(
        `/projects?search=${encodeURIComponent(search)}&sort=${sort}&page=${page}&pageSize=12`,
      ),
    refetchInterval: (q) =>
      q.state.data?.items.some((p) => p.audits?.some((a) => active(a.status))) ? 8000 : false,
  });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/users/me/usage') });
  const items = query.data?.items ?? [];
  const performance = items
    .map((p) => scoreFor(p.audits?.[0], 'performance'))
    .filter((s): s is number => s !== null);
  const average = performance.length
    ? Math.round(performance.reduce((a, b) => a + b, 0) / performance.length)
    : null;
  const name = user.data?.user.name?.split(' ')[0];
  return (
    <>
      <PageHeading
        eyebrow="A CLEARER PICTURE"
        title={name ? `Your websites, ${name}.` : 'Your websites, in focus.'}
        description="Measure what matters. Find your next improvement."
        actions={
          <ButtonLink href="/projects/new">
            <Plus size={16} />
            {t('newProject')}
          </ButtonLink>
        }
      />
      <VerificationNotice />
      <div className="stat-grid">
        <Stat
          title="Total projects"
          value={usage.data?.projects ?? query.data?.total ?? '—'}
          detail={
            usage.data
              ? `of ${usage.data.maxProjects} available in your workspace`
              : 'Your websites, organized'
          }
          icon={FolderOpen}
        />
        <Stat
          title="Audits today"
          value={usage.data?.auditsToday ?? '—'}
          detail={
            usage.data
              ? `${Math.max(0, usage.data.auditsPerDay - usage.data.auditsToday)} of ${usage.data.auditsPerDay} audits remaining`
              : 'Daily usage updates after each run'
          }
          icon={Activity}
        />
        <Stat
          title="Mobile performance"
          value={average ?? '—'}
          detail={
            performance.length
              ? 'Average of visible latest audit scores'
              : 'Run an audit to get your first score'
          }
          icon={Zap}
        />
        <Stat
          title="Active audits"
          value={usage.data?.activeAudits ?? '—'}
          detail="Actual checks, running in the background"
          icon={Clock3}
        />
      </div>
      <section aria-labelledby="projects-heading">
        <div className="section-toolbar">
          <div className="section-title">
            <h2 id="projects-heading">Your projects</h2>
            {query.data ? <span className="count-pill">{query.data.total}</span> : null}
          </div>
          <div className="toolbar-controls">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
            />
            <select
              className="select"
              aria-label="Sort projects"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="updatedAt">Recently updated</option>
              <option value="createdAt">Newest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorMessage error={query.error} onRetry={() => void query.refetch()} />
        ) : !items.length ? (
          <EmptyState
            title={search ? t('noResults') : t('noProjects')}
            description={search ? 'Try a different name or website address.' : t('noProjectsBody')}
            href={search ? undefined : '/projects/new'}
          />
        ) : (
          <div className="project-grid">
            {items.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
            {usage.data && usage.data.projects < usage.data.maxProjects ? (
              <Link className="project-new" href="/projects/new">
                <span>
                  <Plus size={20} />
                </span>
                <strong>A new website. A fresh perspective.</strong>
                <p>Add another project to your workspace.</p>
              </Link>
            ) : null}
          </div>
        )}
        {query.data && query.data.total > query.data.pageSize ? (
          <div className="pagination">
            <span>
              Page {page} of {Math.ceil(query.data.total / query.data.pageSize)}
            </span>
            <div>
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page * query.data.pageSize >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      <div className="info-banner">
        <Lightbulb size={22} />
        <div>
          <h3>Good websites are built one improvement at a time.</h3>
          <p>
            Start with the highest impact findings, make a change, and run another audit to see the
            difference.
          </p>
        </div>
        <a className="text-link" href="/#how-it-works">
          How audits work
          <ArrowUpRight size={14} />
        </a>
      </div>
      <ErrorMessage error={usage.error} />
    </>
  );
}
export function Stat({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: React.ReactNode;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">
          <Icon size={15} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <p className="stat-detail">{detail}</p>
    </Card>
  );
}
