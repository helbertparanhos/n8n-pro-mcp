import { setTimeout as sleep } from "node:timers/promises";
import type { HealthReport, N8nListResponse, WebhookResult } from "./types.js";

export interface N8nClientConfig {
  baseUrl: string;
  apiKey: string;
  webhookBaseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
}

export class N8nApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "N8nApiError";
  }

  detailed(): string {
    const parts = [this.message];
    if (this.hint) parts.push(`Hint: ${this.hint}`);
    return parts.join(" — ");
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type Query = Record<string, string | number | boolean | undefined>;

export class N8nClient {
  private readonly apiBase: string;
  private readonly webhookBase: string;

  constructor(private readonly config: N8nClientConfig) {
    const root = config.baseUrl.replace(/\/+$/, "");
    this.apiBase = `${root}/api/v1`;
    this.webhookBase = (config.webhookBaseUrl ?? root).replace(/\/+$/, "");
  }

  static fromEnv(): N8nClient {
    const baseUrl = process.env.N8N_API_URL;
    const apiKey = process.env.N8N_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error(
        "Missing configuration: set N8N_API_URL (e.g. https://n8n.yourdomain.com) and N8N_API_KEY " +
          "(n8n → Settings → n8n API → Create API key) in the environment of this MCP server."
      );
    }
    return new N8nClient({
      baseUrl,
      apiKey,
      webhookBaseUrl: process.env.N8N_WEBHOOK_BASE_URL || undefined,
      timeoutMs: parsePositiveInt(process.env.N8N_API_TIMEOUT_MS, 30_000),
      maxRetries: parseNonNegativeInt(process.env.N8N_MAX_RETRIES, 3),
    });
  }

  get instanceUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown } = {}
  ): Promise<T> {
    const url = buildUrl(`${this.apiBase}${path}`, opts.query);
    // Only GETs are retried: a timed-out POST/PUT/DELETE may have reached the
    // server, and retrying would duplicate its side effects.
    const retries = method === "GET" ? this.config.maxRetries : 0;
    const response = await this.fetchWithRetry(
      url,
      {
        method,
        headers: {
          "X-N8N-API-KEY": this.config.apiKey,
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      retries
    );

    const text = await response.text();
    const parsed = safeJsonParse(text);

    if (!response.ok) {
      const apiMessage =
        (parsed as { message?: string } | undefined)?.message ?? text.slice(0, 300);
      throw new N8nApiError(
        `n8n API ${method} ${path} returned ${response.status}: ${apiMessage || response.statusText}`,
        response.status,
        hintForStatus(response.status, path)
      );
    }

    return (parsed ?? {}) as T;
  }

  /** Follows cursor-based pagination, aggregating `data` across pages up to maxItems. */
  async paginate<T>(path: string, query: Query = {}, maxItems = 1000): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<N8nListResponse<T>>("GET", path, {
        query: {
          ...query,
          limit: Math.min(100, maxItems - items.length),
          cursor,
        },
      });
      const pageItems = page.data ?? [];
      // An empty page with a cursor would loop forever — treat it as the end.
      if (pageItems.length === 0) break;
      items.push(...pageItems);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length < maxItems);
    return items;
  }

  /** Calls a production or test webhook on the instance (queue mode: served by webhook processors). */
  async callWebhook(
    method: "GET" | "POST" | "PUT" | "DELETE",
    webhookPath: string,
    opts: { payload?: unknown; headers?: Record<string, string>; test?: boolean } = {}
  ): Promise<WebhookResult> {
    if (/\.\.|:\/\/|^\/\//.test(webhookPath)) {
      throw new N8nApiError(
        `Invalid webhook path: ${webhookPath}`,
        undefined,
        "The path must be the segment configured in the Webhook node — no '..', '//' or URL schemes."
      );
    }
    const prefix = opts.test ? "webhook-test" : "webhook";
    const cleanPath = webhookPath.replace(/^\/+/, "");
    const url = `${this.webhookBase}/${prefix}/${cleanPath}`;
    // Never retried: webhook calls execute workflows with real side effects,
    // and a timed-out call may already be running on a worker.
    const response = await this.fetchWithRetry(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          ...(opts.payload !== undefined ? { "content-type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.payload !== undefined ? JSON.stringify(opts.payload) : undefined,
      },
      0
    );

    const text = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      headers: filterResponseHeaders(response.headers),
      body: safeJsonParse(text) ?? text,
    };
  }

  /** Probes /healthz, /healthz/readiness and the REST API. In queue mode this checks the main process. */
  async health(): Promise<HealthReport> {
    const report: HealthReport = {
      instance: { url: this.instanceUrl },
      healthz: await this.probe(`${this.instanceUrl}/healthz`),
      readiness: await this.probe(`${this.instanceUrl}/healthz/readiness`),
      api: { ok: false },
      summary: "",
    };

    try {
      await this.request("GET", "/workflows", { query: { limit: 1 } });
      report.api.ok = true;
    } catch (error) {
      report.api.error = error instanceof Error ? error.message : String(error);
    }

    const failing = [
      !report.healthz.ok && "healthz",
      !report.readiness.ok && "readiness (DB/migrations)",
      !report.api.ok && "REST API (auth?)",
    ].filter(Boolean);
    report.summary = failing.length
      ? `DEGRADED — failing checks: ${failing.join(", ")}`
      : "HEALTHY — main process is up, DB is ready and the API is reachable.";
    return report;
  }

  private async probe(url: string): Promise<HealthReport["healthz"]> {
    try {
      const response = await this.fetchOnce(url, { method: "GET" });
      const body = safeJsonParse(await response.text());
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries: number
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(Math.min(500 * 2 ** (attempt - 1), 8_000));
      try {
        const response = await this.fetchOnce(url, init);
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          lastError = new N8nApiError(
            `Transient HTTP ${response.status} from ${url}`,
            response.status
          );
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new N8nApiError(
      `Request to ${url} failed after ${maxRetries + 1} attempt(s): ${reason}`,
      undefined,
      "Check that the n8n instance is reachable from this machine and N8N_API_URL is correct."
    );
  }

  private fetchOnce(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs) });
  }
}

export function buildUrl(base: string, query?: Query): string {
  if (!query) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function safeJsonParse(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const SAFE_RESPONSE_HEADERS = new Set(["content-type", "content-length", "date"]);

/** Keeps only innocuous headers — webhook responses may carry set-cookie or auth material. */
export function filterResponseHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].filter(([name]) => SAFE_RESPONSE_HEADERS.has(name.toLowerCase()))
  );
}

function hintForStatus(status: number, path: string): string | undefined {
  switch (status) {
    case 401:
      return "Invalid or expired API key. Recreate it in n8n → Settings → n8n API and update N8N_API_KEY.";
    case 403:
      return "The API key lacks permission for this operation, or the feature requires a license plan (variables, projects and source control are licensed features).";
    case 404:
      if (path.includes("/retry") || path.startsWith("/source-control") || path.startsWith("/projects") || path.startsWith("/variables")) {
        return "Resource not found — or this endpoint is not available in your n8n version/plan. Self-hosted: check the instance version and license.";
      }
      return "Resource not found. Check the ID — list tools (e.g. list_workflows) return valid IDs.";
    case 400:
      return "The n8n API rejected the payload. Check required fields and enum values in the error message above.";
    default:
      return undefined;
  }
}
