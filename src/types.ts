export interface N8nListResponse<T> {
  data: T[];
  nextCursor?: string | null;
}

export interface N8nWorkflowNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  nodes: N8nWorkflowNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  tags?: N8nTag[];
  createdAt?: string;
  updatedAt?: string;
}

export interface N8nTag {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface N8nExecution {
  id: number | string;
  finished: boolean;
  mode: string;
  status?: string;
  retryOf?: string | null;
  retrySuccessId?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  waitTill?: string | null;
  workflowId: number | string;
  workflowData?: { name?: string };
  data?: unknown;
}

export interface N8nVariable {
  id: string;
  key: string;
  value: string;
  type?: string;
}

export interface N8nProject {
  id: string;
  name: string;
  type?: string;
}

export interface N8nUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  isPending?: boolean;
  createdAt?: string;
}

export interface N8nCredential {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface HealthReport {
  instance: { url: string };
  healthz: { ok: boolean; status?: number; body?: unknown; error?: string };
  readiness: { ok: boolean; status?: number; body?: unknown; error?: string };
  api: { ok: boolean; error?: string };
  summary: string;
}
