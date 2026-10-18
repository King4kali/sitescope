export const AUDIT_QUEUE = 'audits';
export const REPORT_QUEUE = 'reports';
export const TERMINAL_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export type AuditStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export type ModuleName =
  | 'http'
  | 'seo'
  | 'links'
  | 'security'
  | 'performance'
  | 'accessibility'
  | 'visual'
  | 'fieldData';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface FindingInput {
  category: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: unknown;
  pageUrl?: string;
}
export interface ModuleResult {
  module: ModuleName;
  device: string;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  score: number | null;
  metrics: Record<string, unknown>;
  rawData: unknown;
  findings: FindingInput[];
  errorCode: string | null;
  durationMs: number;
}
export interface AuditJob {
  auditId: string;
}
export interface ReportJob {
  exportId: string;
}
export interface BrowserRequest {
  url: string;
  auditId: string;
}
export interface BrowserOutput {
  results: ModuleResult[];
  screenshots: { device: string; data: string; mimeType: string }[];
  finalUrl?: string;
}
export const DEFAULT_LIMITS = {
  projects: 3,
  auditsPerDay: 5,
  pages: 5,
  links: 30,
  redirects: 5,
  maxBytes: 5_000_000,
  requestTimeoutMs: 15_000,
  auditTimeoutMs: 240_000,
};
export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}
