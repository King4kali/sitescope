'use client';
import { useQuery } from '@tanstack/react-query';
import type { User } from './types';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'SiteScope',
      ...options.headers,
    },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.code || 'REQUEST_FAILED',
      data?.message ||
        (response.status === 502
          ? 'The audit service is currently unavailable. Please try again shortly.'
          : 'Something went wrong. Please try again.'),
      data?.requestId,
      response.status,
    );
  return data as T;
}
export const post = <T>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function useUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
}
export const active = (status: string) => ['QUEUED', 'RUNNING'].includes(status);
export function date(value?: string | null, withTime = true) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}
export function host(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
export function duration(audit: { startedAt: string | null; finishedAt: string | null }) {
  if (!audit.startedAt || !audit.finishedAt) return '—';
  return `${Math.round((new Date(audit.finishedAt).getTime() - new Date(audit.startedAt).getTime()) / 1000)}s`;
}
