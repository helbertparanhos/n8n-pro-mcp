import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import { N8nApiError } from "../client.js";
import type { N8nExecution, N8nListResponse } from "../types.js";
import {
  classifyExecutionState,
  collectNodeErrors,
  compactError,
  isPrunable,
  type ExecutionResultData,
} from "./execution-logic.js";

function summarize(execution: N8nExecution) {
  return {
    id: execution.id,
    workflowId: execution.workflowId,
    workflowName: execution.workflowData?.name,
    status: execution.status ?? (execution.finished ? "success" : "unknown"),
    mode: execution.mode,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    waitTill: execution.waitTill,
    durationMs: durationMs(execution),
    retryOf: execution.retryOf ?? undefined,
  };
}

function durationMs(execution: N8nExecution): number | undefined {
  if (!execution.startedAt || !execution.stoppedAt) return undefined;
  return new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime();
}

export const executionTools: ToolDef[] = [
  defineTool({
    name: "list_executions",
    description:
      "List executions with filters (status, workflow, project) and automatic pagination. Returns lightweight summaries with duration — use get_execution for full node-level data.",
    schema: z.object({
      status: z
        .enum(["error", "success", "waiting", "canceled", "crashed", "new", "running"])
        .optional()
        .describe("Filter by execution status (older n8n versions only accept error/success/waiting)"),
      workflowId: z.string().optional().describe("Filter by workflow ID"),
      projectId: z.string().optional().describe("Filter by project ID"),
      maxItems: z.number().int().min(1).max(1000).default(100).describe("Max executions to return"),
    }),
    handler: async (args, client) => {
      const executions = await client.paginate<N8nExecution>(
        "/executions",
        {
          status: args.status,
          workflowId: args.workflowId,
          projectId: args.projectId,
          includeData: false,
        },
        args.maxItems
      );
      return executions.map(summarize);
    },
  }),

  defineTool({
    name: "get_execution",
    description:
      "Get one execution by ID. includeData=true returns the full run data (node inputs/outputs and error details) — useful to debug a failed run.",
    schema: z.object({
      id: z.string().describe("Execution ID"),
      includeData: z.boolean().default(false).describe("Include full node-level run data (large)"),
    }),
    handler: async (args, client) => {
      const execution = await client.request<N8nExecution>("GET", `/executions/${encodeURIComponent(args.id)}`, {
        query: { includeData: args.includeData },
      });
      return args.includeData ? execution : summarize(execution);
    },
  }),

  defineTool({
    name: "delete_execution",
    description: "Delete a single execution record by ID (frees DB space; cannot be undone).",
    schema: z.object({ id: z.string().describe("Execution ID") }),
    handler: async (args, client) => {
      await client.request("DELETE", `/executions/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id };
    },
  }),

  defineTool({
    name: "retry_execution",
    description:
      "Retry a failed or stopped execution by ID. Requires a recent n8n version exposing retry in the public API — if unavailable (404), re-trigger the workflow via run_webhook instead.",
    schema: z.object({ id: z.string().describe("Execution ID to retry") }),
    handler: async (args, client) => {
      const result = await client.request("POST", `/executions/${encodeURIComponent(args.id)}/retry`);
      return { retried: true, originalId: args.id, result };
    },
  }),

  defineTool({
    name: "list_running_executions",
    description:
      "Queue-mode view: list executions currently running or waiting in the queue. Tries the API status filter first and falls back to scanning recent executions for ones without a stop time.",
    schema: z.object({
      maxItems: z.number().int().min(1).max(500).default(100).describe("Max executions to return"),
    }),
    handler: async (args, client) => {
      try {
        const running = await client.paginate<N8nExecution>(
          "/executions",
          { status: "running", includeData: false },
          args.maxItems
        );
        return { source: "status-filter", count: running.length, executions: running.map(summarize) };
      } catch (error) {
        if (!(error instanceof N8nApiError && error.status === 400)) throw error;
        const recent = await client.paginate<N8nExecution>(
          "/executions",
          { includeData: false },
          500
        );
        const running = recent.filter((e) => !e.stoppedAt && !e.finished).slice(0, args.maxItems);
        return {
          source: "fallback-scan (this n8n version does not accept status=running)",
          count: running.length,
          executions: running.map(summarize),
        };
      }
    },
  }),

  defineTool({
    name: "run_webhook",
    description:
      "Trigger a workflow through its Webhook node. Calls {instance}/webhook/{path} (or /webhook-test/{path} with test=true, which requires the workflow open in 'Listen for test event' mode). In queue mode the call returns according to the webhook's response mode.",
    schema: z
      .object({
        path: z.string().describe("Webhook path as configured in the Webhook node (without /webhook/ prefix)"),
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("POST").describe("HTTP method the Webhook node expects"),
        payload: z.record(z.unknown()).optional().describe("JSON body to send (POST/PUT/DELETE — not allowed with GET)"),
        headers: z.record(z.string()).optional().describe("Extra HTTP headers (e.g. webhook auth)"),
        test: z.boolean().default(false).describe("Call the test URL (/webhook-test/) instead of production"),
      })
      .refine((a) => a.method !== "GET" || a.payload === undefined, {
        message: "GET requests cannot carry a payload — remove the payload or use POST/PUT/DELETE.",
        path: ["payload"],
      }),
    handler: async (args, client) =>
      client.callWebhook(args.method, args.path, {
        payload: args.payload,
        headers: args.headers,
        test: args.test,
      }),
  }),

  defineTool({
    name: "summarize_execution_error",
    description:
      "Debug a failed execution without flooding the context: fetches the full run data and returns only the failing node, error message/description, a short stack and per-node errors. Use instead of get_execution includeData=true when you only need to know what broke.",
    annotations: { readOnlyHint: true },
    schema: z.object({ id: z.string().describe("Execution ID (see list_executions with status=error)") }),
    handler: async (args, client) => {
      const execution = await client.request<
        N8nExecution & { data?: { resultData?: ExecutionResultData } }
      >("GET", `/executions/${encodeURIComponent(args.id)}`, { query: { includeData: true } });
      const resultData = execution.data?.resultData;
      const nodeErrors = collectNodeErrors(resultData);
      return {
        ...summarize(execution),
        failedNode: resultData?.error?.node?.name ?? resultData?.lastNodeExecuted,
        lastNodeExecuted: resultData?.lastNodeExecuted,
        error: compactError(resultData?.error),
        nodeErrors,
        hint:
          !resultData?.error && nodeErrors.length === 0
            ? "No error payload found — the execution may have succeeded, be still running, or had its data pruned."
            : undefined,
      };
    },
  }),

  defineTool({
    name: "wait_for_execution",
    description:
      "Poll an execution until it reaches a terminal state (success/error/crashed/canceled) or the timeout expires. Returns early with waiting=true if the execution pauses on a Wait node. Closes the loop after run_webhook in queue mode, where execution happens asynchronously on workers. The timeout is best-effort: each poll request has its own HTTP timeout, so total wall time can slightly exceed timeoutSeconds.",
    annotations: { readOnlyHint: true },
    schema: z.object({
      id: z.string().describe("Execution ID to wait for"),
      timeoutSeconds: z.number().int().min(1).max(600).default(60).describe("Max time to wait"),
      pollSeconds: z.number().int().min(1).max(30).default(2).describe("Interval between checks"),
    }),
    handler: async (args, client) => {
      const deadline = Date.now() + args.timeoutSeconds * 1000;
      const startedPolling = Date.now();
      for (;;) {
        const execution = await client.request<N8nExecution>(
          "GET",
          `/executions/${encodeURIComponent(args.id)}`,
          { query: { includeData: false } }
        );
        const state = classifyExecutionState(execution);
        if (state === "terminal") {
          return {
            ...summarize(execution),
            waitedSeconds: Math.round((Date.now() - startedPolling) / 1000),
          };
        }
        if (state === "waiting") {
          return {
            waiting: true,
            ...summarize(execution),
            waitedSeconds: Math.round((Date.now() - startedPolling) / 1000),
            hint: "Execution is paused on a Wait node and will resume at waitTill — poll again later if needed.",
          };
        }
        if (Date.now() + args.pollSeconds * 1000 > deadline) {
          return {
            timedOut: true,
            waitedSeconds: Math.round((Date.now() - startedPolling) / 1000),
            last: summarize(execution),
            hint: "Execution still not terminal — check again with get_execution or increase timeoutSeconds.",
          };
        }
        await sleep(args.pollSeconds * 1000);
      }
    },
  }),

  defineTool({
    name: "prune_executions",
    description:
      "Bulk-delete finished execution records by filter (status, workflow, older than N days) to reclaim database space. Runs as a dry run by default — set dryRun=false to actually delete. Deletion is permanent and cannot be undone. Running/waiting executions are never touched.",
    annotations: { destructiveHint: true },
    schema: z.object({
      status: z
        .enum(["error", "success", "canceled", "crashed"])
        .optional()
        .describe("Only prune executions with this terminal status"),
      workflowId: z.string().optional().describe("Only prune executions of this workflow"),
      olderThanDays: z
        .number()
        .min(0)
        .optional()
        .describe("Only prune executions that stopped more than N days ago"),
      maxDelete: z.number().int().min(1).max(1000).default(100).describe("Safety cap per call"),
      dryRun: z.boolean().default(true).describe("Preview what would be deleted without deleting"),
    }),
    handler: async (args, client) => {
      const cutoff =
        args.olderThanDays !== undefined
          ? Date.now() - args.olderThanDays * 86_400_000
          : undefined;

      // The API returns newest first, so old executions can sit many pages
      // deep — follow the cursor until enough candidates are found.
      const SCAN_CAP = 5000;
      const candidates: N8nExecution[] = [];
      let scanned = 0;
      let reachedEnd = false;
      let cursor: string | undefined;
      do {
        const page = await client.request<N8nListResponse<N8nExecution>>("GET", "/executions", {
          query: {
            status: args.status,
            workflowId: args.workflowId,
            includeData: false,
            limit: 100,
            cursor,
          },
        });
        const items = page.data ?? [];
        scanned += items.length;
        for (const execution of items) {
          if (candidates.length >= args.maxDelete) break;
          if (isPrunable(execution, cutoff)) candidates.push(execution);
        }
        cursor = page.nextCursor ?? undefined;
        if (!cursor || items.length === 0) reachedEnd = true;
      } while (!reachedEnd && candidates.length < args.maxDelete && scanned < SCAN_CAP);

      if (args.dryRun) {
        return {
          dryRun: true,
          scanned,
          reachedEnd,
          wouldDelete: candidates.length,
          sample: candidates.slice(0, 20).map(summarize),
          hint: candidates.length
            ? "Call again with dryRun=false to delete."
            : reachedEnd
              ? undefined
              : `Nothing prunable among the ${scanned} most recent executions; older ones may exist beyond the scan cap — narrow with workflowId/status or run again after pruning.`,
        };
      }

      const failed: Array<{ id: string | number; error: string }> = [];
      let deleted = 0;
      for (const execution of candidates) {
        try {
          await client.request("DELETE", `/executions/${encodeURIComponent(String(execution.id))}`);
          deleted++;
        } catch (error) {
          failed.push({
            id: execution.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { deleted, scanned, reachedEnd, failed: failed.length ? failed : undefined };
    },
  }),

  defineTool({
    name: "get_execution_stats",
    description:
      "Aggregate execution health over a recent sample: per-workflow success/error/waiting counts, success rate and average duration. The queue-mode dashboard in one call — spot failing or slow workflows.",
    schema: z.object({
      workflowId: z.string().optional().describe("Restrict stats to one workflow"),
      sample: z.number().int().min(10).max(1000).default(200).describe("How many recent executions to aggregate"),
    }),
    handler: async (args, client) => {
      const executions = await client.paginate<N8nExecution>(
        "/executions",
        { workflowId: args.workflowId, includeData: false },
        args.sample
      );

      const byWorkflow = new Map<
        string,
        { workflowId: string; workflowName?: string; total: number; byStatus: Record<string, number>; durations: number[] }
      >();
      for (const execution of executions) {
        const key = String(execution.workflowId);
        const entry =
          byWorkflow.get(key) ??
          { workflowId: key, workflowName: execution.workflowData?.name, total: 0, byStatus: {}, durations: [] };
        entry.total += 1;
        const status = execution.status ?? (execution.finished ? "success" : "unknown");
        entry.byStatus[status] = (entry.byStatus[status] ?? 0) + 1;
        const duration = durationMs(execution);
        if (duration !== undefined && duration >= 0) entry.durations.push(duration);
        byWorkflow.set(key, entry);
      }

      const workflows = [...byWorkflow.values()]
        .map(({ durations, ...entry }) => ({
          ...entry,
          successRate: entry.total
            ? Math.round(((entry.byStatus["success"] ?? 0) / entry.total) * 100) / 100
            : null,
          avgDurationMs: durations.length
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : null,
        }))
        .sort((a, b) => (a.successRate ?? 1) - (b.successRate ?? 1));

      return { sampled: executions.length, workflows };
    },
  }),
];
