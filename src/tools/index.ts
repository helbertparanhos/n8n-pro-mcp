import type { N8nClient } from "../client.js";
import { toMcpTool, wrapHandler, type ToolDef, type ToolResult } from "./registry.js";
import { workflowTools } from "./workflows.js";
import { executionTools } from "./executions.js";
import { tagTools } from "./tags.js";
import { credentialTools } from "./credentials.js";
import { variableTools } from "./variables.js";
import { projectTools } from "./projects.js";
import { userTools } from "./users.js";
import { systemTools } from "./system.js";

export const allTools: ToolDef[] = [
  ...workflowTools,
  ...executionTools,
  ...tagTools,
  ...credentialTools,
  ...variableTools,
  ...projectTools,
  ...userTools,
  ...systemTools,
];

export function buildToolList(): ReturnType<typeof toMcpTool>[] {
  return allTools.map(toMcpTool);
}

export function buildHandlers(
  client: N8nClient
): Record<string, (rawArgs: unknown) => Promise<ToolResult>> {
  return Object.fromEntries(allTools.map((def) => [def.name, wrapHandler(def, client)]));
}
