import type { N8nExecution } from "../types.js";

export interface NodeRunError {
  message?: string;
  description?: string;
  name?: string;
  stack?: string;
}

export interface ExecutionResultData {
  error?: NodeRunError & { node?: { name?: string } };
  lastNodeExecuted?: string;
  runData?: Record<string, Array<{ error?: NodeRunError; executionTime?: number }>>;
}

const TERMINAL_STATUSES = new Set(["success", "error", "crashed", "canceled"]);
const ACTIVE_STATUSES = new Set(["running", "waiting", "new"]);

export function compactError(error: NodeRunError | undefined) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    description: error.description,
    stack: error.stack?.split("\n").slice(0, 5).join("\n"),
  };
}

export function collectNodeErrors(resultData: ExecutionResultData | undefined) {
  return Object.entries(resultData?.runData ?? {}).flatMap(([node, runs]) =>
    runs
      .filter((run) => run.error)
      .map((run) => ({ node, executionTime: run.executionTime, ...compactError(run.error) }))
  );
}

/**
 * Executions paused on a Wait node have BOTH `stoppedAt` set and
 * status "waiting"/`waitTill` — they are not terminal and must never be pruned.
 */
export function classifyExecutionState(
  execution: N8nExecution
): "terminal" | "waiting" | "running" {
  const status = execution.status ?? (execution.finished ? "success" : undefined);
  if (status && TERMINAL_STATUSES.has(status)) return "terminal";
  if (status === "waiting" || execution.waitTill) return "waiting";
  return execution.stoppedAt ? "terminal" : "running";
}

/** An execution may be pruned only when truly finished: stopped, not paused on a Wait node, and older than the cutoff (when given). */
export function isPrunable(execution: N8nExecution, cutoffMs?: number): boolean {
  if (!execution.stoppedAt || execution.waitTill) return false;
  if (execution.status && ACTIVE_STATUSES.has(execution.status)) return false;
  if (cutoffMs !== undefined && new Date(execution.stoppedAt).getTime() >= cutoffMs) return false;
  return true;
}
