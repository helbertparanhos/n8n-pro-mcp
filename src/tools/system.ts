import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";

export const systemTools: ToolDef[] = [
  defineTool({
    name: "check_health",
    description:
      "Check instance health: /healthz (process up), /healthz/readiness (DB connected & migrated) and REST API reachability/auth. In queue mode this validates the main process — pair with list_running_executions and get_execution_stats to assess queue throughput.",
    schema: z.object({}),
    handler: (_args, client) => client.health(),
  }),

  defineTool({
    name: "generate_audit",
    description:
      "Generate n8n's built-in security audit: flags abandoned workflows, unused credentials, risky nodes (filesystem/instance access), and more. Optionally restrict categories or tune the abandoned-workflow threshold.",
    schema: z.object({
      daysAbandonedWorkflow: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Days without execution for a workflow to count as abandoned (n8n default: 90)"),
      categories: z
        .array(z.enum(["credentials", "database", "nodes", "filesystem", "instance"]))
        .optional()
        .describe("Audit categories to run (default: all)"),
    }),
    handler: (args, client) =>
      client.request("POST", "/audit", {
        body: {
          additionalOptions: {
            ...(args.daysAbandonedWorkflow !== undefined
              ? { daysAbandonedWorkflow: args.daysAbandonedWorkflow }
              : {}),
            ...(args.categories ? { categories: args.categories } : {}),
          },
        },
      }),
  }),

  defineTool({
    name: "pull_source_control",
    description:
      "Pull changes from the connected source-control repository (requires the Source Control feature configured on the instance). force=true permanently discards local changes on the instance — cannot be undone.",
    annotations: { destructiveHint: true },
    schema: z.object({
      force: z.boolean().default(false).describe("Discard local changes and force-pull"),
      variables: z
        .record(z.string())
        .optional()
        .describe("Values for variables defined in the repository"),
    }),
    handler: (args, client) =>
      client.request("POST", "/source-control/pull", {
        body: { force: args.force, ...(args.variables ? { variables: args.variables } : {}) },
      }),
  }),
];
