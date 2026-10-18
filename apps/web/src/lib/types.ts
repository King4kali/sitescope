export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerifiedAt: string | null;
  createdAt?: string;
  blocked?: boolean;
};
export type Result = {
  id: string;
  module: string;
  device: string;
  status: string;
  score: number | null;
  metricsJson: Record<string, unknown>;
  rawDataJson: unknown;
  errorCode: string | null;
  durationMs: number;
};
export type Finding = {
  id: string;
  category: string;
  ruleId: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
  evidenceJson: unknown;
};
export type Artifact = {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};
export type Audit = {
  id: string;
  projectId: string;
  targetUrl: string;
  finalUrl: string | null;
  status: string;
  stage: string;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  results: Result[];
  findings?: Finding[];
  artifacts?: Artifact[];
  pages?: {
    id: string;
    url: string;
    httpStatus: number | null;
    responseTimeMs: number | null;
    title: string | null;
    metaJson: unknown;
  }[];
  events?: { id: string; stage: string; message: string; createdAt: string }[];
  project?: Project;
  _count?: { findings: number };
  toolVersionsJson?: Record<string, unknown>;
  configJson?: Record<string, unknown>;
};
export type Project = {
  id: string;
  name: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  audits?: Audit[];
  _count?: { audits: number };
};
export type List<T> = { items: T[]; total: number; page: number; pageSize: number };
export type ExportJob = { id: string; status: string; url?: string; errorCode?: string };
