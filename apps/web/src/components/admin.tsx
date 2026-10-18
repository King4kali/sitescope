'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Clock3,
  Database,
  HardDrive,
  Server,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { api, date, useUser } from '@/lib/api';
import type { List, User } from '@/lib/types';
import { Stat } from './dashboard';
import {
  Button,
  Card,
  ErrorMessage,
  Loading,
  Modal,
  PageHeading,
  SearchBox,
  StatusBadge,
} from './ui';
type Stats = {
  users: number;
  projects: number;
  activeAudits: number;
  failedAudits: number;
  averageDurationMs: number | null;
  storage: { artifactBytes: number; artifacts: number; completedExports: number };
  queues: { audits: Record<string, number>; reports: Record<string, number> };
  workers: { connected: number; activeJobs: number };
  services: Record<string, string>;
};
export function AdminPage() {
  const user = useUser();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<User | null>(null);
  const allowed = user.data?.user.role === 'ADMIN';
  const stats = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api<Stats>('/admin/stats'),
    enabled: allowed,
    refetchInterval: 15000,
  });
  const users = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () =>
      api<List<User>>(`/admin/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=15`),
    enabled: allowed,
  });
  const block = useMutation({
    mutationFn: (u: User) =>
      api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ blocked: !u.blocked }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-users'] });
      setSelected(null);
    },
  });
  if (!allowed)
    return (
      <div className="standalone-state">
        <ShieldCheck size={35} style={{ margin: '0 auto 20px' }} />
        <h1>This view is for administrators.</h1>
        <p>Your projects are available in your workspace.</p>
      </div>
    );
  const s = stats.data;
  return (
    <>
      <PageHeading
        eyebrow="UNDER THE HOOD"
        title="System overview."
        description="A live look at service health, background work, and workspace accounts."
        actions={<span className="muted small">Refreshes every 15 seconds</span>}
      />
      {stats.isPending ? (
        <Loading />
      ) : stats.error ? (
        <ErrorMessage error={stats.error} onRetry={() => void stats.refetch()} />
      ) : s ? (
        <>
          <div className="stat-grid">
            <Stat
              title="Registered users"
              value={s.users}
              detail={`${s.projects} projects across workspaces`}
              icon={Users}
            />
            <Stat
              title="Active audits"
              value={s.activeAudits}
              detail={`${s.workers.connected} connected workers`}
              icon={Activity}
            />
            <Stat
              title="Failed audits"
              value={s.failedAudits}
              detail="Persisted terminal failures"
              icon={XCircle}
            />
            <Stat
              title="Average audit time"
              value={
                s.averageDurationMs === null ? '—' : `${Math.round(s.averageDurationMs / 1000)}s`
              }
              detail="Across finished runs"
              icon={Clock3}
            />
          </div>
          <div className="system-grid">
            <Card>
              <div className="card-header">
                <h2>Background queues</h2>
                <Server size={17} className="muted" />
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {Object.entries(s.queues).map(([name, queue]) => (
                  <div key={name}>
                    <h3 style={{ fontSize: 12, margin: '10px 0' }}>
                      {name === 'audits' ? 'Audit queue' : 'PDF report queue'}
                    </h3>
                    {['waiting', 'active', 'delayed', 'failed', 'completed'].map((status) => (
                      <div className="service-row" key={status}>
                        <span style={{ textTransform: 'capitalize' }}>{status}</span>
                        <strong>{queue[status] ?? 0}</strong>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
            <div className="settings-stack">
              <Card>
                <div className="card-header">
                  <h2>Service health</h2>
                  <Database size={17} className="muted" />
                </div>
                <div className="card-body" style={{ paddingTop: 0 }}>
                  {Object.entries(s.services).map(([name, status]) => (
                    <div className="service-row" key={name}>
                      <span>
                        {name === 'postgres' ? 'PostgreSQL' : name === 'redis' ? 'Redis' : name}
                      </span>
                      <StatusBadge status={status === 'up' ? 'COMPLETED' : 'FAILED'} />
                    </div>
                  ))}
                  <div className="service-row">
                    <span>Connected workers</span>
                    <strong>{s.workers.connected}</strong>
                  </div>
                  <div className="service-row">
                    <span>Active worker jobs</span>
                    <strong>{s.workers.activeJobs}</strong>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="card-header">
                  <h2>Object storage</h2>
                  <HardDrive size={17} className="muted" />
                </div>
                <div className="card-body" style={{ paddingTop: 0 }}>
                  <div className="service-row">
                    <span>Tracked artifacts</span>
                    <strong>{s.storage.artifacts}</strong>
                  </div>
                  <div className="service-row">
                    <span>Artifact size</span>
                    <strong>{(s.storage.artifactBytes / 1024 / 1024).toFixed(2)} MB</strong>
                  </div>
                  <div className="service-row">
                    <span>Completed PDF exports</span>
                    <strong>{s.storage.completedExports}</strong>
                  </div>
                  <p className="form-hint">
                    Tracked metadata size. Storage provider overhead and non-artifact objects are
                    excluded.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : null}
      <section style={{ marginTop: 30 }}>
        <div className="section-toolbar">
          <div className="section-title">
            <h2>Workspace accounts</h2>
            {users.data ? <span className="count-pill">{users.data.total}</span> : null}
          </div>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search accounts…"
          />
        </div>
        {users.isPending ? (
          <Loading count={1} />
        ) : users.error ? (
          <ErrorMessage error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <Card>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.items.length ? (
                    users.data.items.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.name || 'Unnamed user'}
                          <br />
                          <span className="muted small">{u.email}</span>
                        </td>
                        <td>{u.role.toLowerCase()}</td>
                        <td>{u.emailVerifiedAt ? 'Verified' : 'Unverified'}</td>
                        <td>{date(u.createdAt, false)}</td>
                        <td>
                          <StatusBadge status={u.blocked ? 'BLOCKED' : 'ACTIVE'} />
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            disabled={u.id === user.data?.user.id}
                            onClick={() => setSelected(u)}
                          >
                            {u.blocked ? 'Unblock' : 'Block'}
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No accounts match your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {users.data && users.data.total > 15 ? (
          <div className="pagination">
            <span>Page {page}</span>
            <div>
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page * 15 >= users.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.blocked ? 'Restore account access?' : 'Block this account?'}
        description={
          selected?.blocked
            ? `${selected.email} will be able to sign in again.`
            : `${selected?.email ?? 'This user'} will be signed out and unable to access the service.`
        }
      >
        <ErrorMessage error={block.error} />
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Cancel
          </Button>
          <Button
            variant={selected?.blocked ? 'primary' : 'danger'}
            loading={block.isPending}
            onClick={() => {
              if (selected) block.mutate(selected);
            }}
          >
            {selected?.blocked ? 'Unblock account' : 'Block account'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
