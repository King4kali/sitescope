'use client';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { active, api } from './api';
import type { Audit, Result } from './types';
export const resultFor = (audit: Audit | undefined, module: string, device = 'mobile') =>
  audit?.results?.find((r) => r.module === module && r.device === device) ||
  audit?.results?.find((r) => r.module === module && r.device === 'all');
export function scoreFor(
  audit: Audit | undefined,
  module: string,
  device = 'mobile',
): number | null {
  const result = resultFor(audit, module, device);
  if (result?.status === 'COMPLETED' && result.score != null) return result.score;
  const performance = resultFor(audit, 'performance', device);
  const categories = performance?.metricsJson?.categoryScores as
    | Record<string, number | undefined>
    | undefined;
  return performance?.status === 'COMPLETED' ? (categories?.[module] ?? null) : null;
}
export const readableModule = (module: string) =>
  ({
    http: 'HTTP response',
    seo: 'Technical SEO',
    links: 'Link health',
    security: 'HTTPS & security headers',
    performance: 'Performance',
    accessibility: 'Accessibility',
    visual: 'Page screenshots',
    fieldData: 'Real-user field data',
  })[module] || module;
export function metricValue(result: Result | undefined, key: string): unknown {
  const canonical: Record<string, string> = {
    FCP: 'fcp',
    LCP: 'lcp',
    CLS: 'cls',
    TBT: 'tbt',
    SpeedIndex: 'speedIndex',
  };
  return result?.metricsJson?.[key] ?? result?.metricsJson?.[canonical[key] ?? key];
}
export function useRunAudit(projectId: string) {
  const router = useRouter();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/projects/${projectId}/audits`, {
        method: 'POST',
        body: '{}',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: async (data) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: ['project', projectId] }),
        client.invalidateQueries({ queryKey: ['usage'] }),
      ]);
      router.push(`/audits/${data.id}`);
    },
  });
}
export function useAudit(id: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api<Audit>(`/audits/${id}/report`),
    refetchInterval: (q) => (q.state.data && active(q.state.data.status) ? 8_000 : false),
  });
  const running = query.data && active(query.data.status);
  useEffect(() => {
    if (!running) return;
    const stream = new EventSource(`/api/v1/audits/${id}/events`, { withCredentials: true });
    stream.onmessage = (e) => {
      try {
        const snapshot = JSON.parse(e.data) as Audit;
        client.setQueryData<Audit>(['audit', id], (old) => (old ? { ...old, ...snapshot } : old));
        if (!active(snapshot.status)) {
          stream.close();
          void Promise.all([
            client.invalidateQueries({ queryKey: ['audit', id] }),
            client.invalidateQueries({ queryKey: ['project', snapshot.projectId] }),
            client.invalidateQueries({ queryKey: ['projects'] }),
            client.invalidateQueries({ queryKey: ['usage'] }),
          ]);
        }
      } catch {
        /* The independent status poll remains active if a stream payload cannot be read. */
      }
    };
    return () => stream.close();
  }, [id, running, client]);
  return query;
}
export function formatMetric(value: unknown, key: string) {
  if (typeof value !== 'number') return value == null ? '—' : String(value);
  if (key === 'CLS') return value.toFixed(3);
  if (['FCP', 'LCP', 'TBT', 'SpeedIndex'].includes(key))
    return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
  return value.toLocaleString('en');
}
