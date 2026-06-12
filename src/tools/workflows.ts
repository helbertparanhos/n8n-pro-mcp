import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import { validateWorkflow } from "../validation/workflow-rules.js";
import type { N8nWorkflow } from "../types.js";

const workflowNodeSchema = z
  .object({
    name: z.string().describe("Unique node name"),
    type: z.string().describe("Node type, e.g. n8n-nodes-base.httpRequest"),
    typeVersion: z.number().optional(),
    position: z.tuple([z.number(), z.number()]).optional(),
    parameters: z.record(z.unknown()).optional(),
    credentials: z.record(z.unknown()).optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

const workflowBodySchema = z.object({
  name: z.string().describe("Workflow name"),
  nodes: z.array(workflowNodeSchema).describe("Workflow nodes"),
  connections: z
    .record(z.unknown())
    .describe('Connections object keyed by source node name, e.g. {"Webhook": {"main": [[{"node": "Set", "type": "main", "index": 0}]]}}'),
  settings: z
    .record(z.unknown())
    .optional()
    .describe("Workflow settings (executionOrder, errorWorkflow, timezone, ...)"),
});

/** Strips read-only fields so a fetched workflow can be sent back on PUT. */
function toWritableWorkflow(workflow: N8nWorkflow): Record<string, unknown> {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
  };
}

export const workflowTools: ToolDef[] = [
  defineTool({
    name: "list_workflows",
    description:
      "List workflows with optional filters (active, tag names, project, name) and automatic cursor pagination. Returns id, name, active state, tags and timestamps — never the heavy node data.",
    schema: z.object({
      active: z.boolean().optional().describe("Filter by active state"),
      tags: z.string().optional().describe("Comma-separated tag names to filter by"),
      name: z.string().optional().describe("Filter by exact workflow name"),
      projectId: z.string().optional().describe("Filter by project ID"),
      maxItems: z.number().int().min(1).max(1000).default(200).describe("Max workflows to return across pages"),
    }),
    handler: async (args, client) => {
      const workflows = await client.paginate<N8nWorkflow>(
        "/workflows",
        {
          active: args.active,
          tags: args.tags,
          name: args.name,
          projectId: args.projectId,
          excludePinnedData: true,
        },
        args.maxItems
      );
      return workflows.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        isArchived: w.isArchived,
        tags: w.tags?.map((t) => t.name),
        nodeCount: w.nodes?.length,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }));
    },
  }),

  defineTool({
    name: "get_workflow",
    description:
      "Get a workflow by ID, including full nodes and connections JSON. Use mode='summary' to get only metadata and the node list (cheaper for inspection).",
    schema: z.object({
      id: z.string().describe("Workflow ID"),
      mode: z.enum(["full", "summary"]).default("full").describe("full = complete JSON; summary = metadata + node names/types only"),
    }),
    handler: async (args, client) => {
      const workflow = await client.request<N8nWorkflow>("GET", `/workflows/${encodeURIComponent(args.id)}`, {
        query: { excludePinnedData: true },
      });
      if (args.mode === "full") return workflow;
      return {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        tags: workflow.tags?.map((t) => t.name),
        settings: workflow.settings,
        nodes: workflow.nodes.map((n) => ({ name: n.name, type: n.type, disabled: n.disabled })),
        updatedAt: workflow.updatedAt,
      };
    },
  }),

  defineTool({
    name: "create_workflow",
    description:
      "Create a new workflow from JSON (name, nodes, connections, settings). Runs offline validation first and refuses to create invalid workflows unless skipValidation=true. New workflows are created inactive — use activate_workflow afterwards.",
    schema: workflowBodySchema.extend({
      skipValidation: z.boolean().default(false).describe("Create even if offline validation finds errors"),
    }),
    handler: async (args, client) => {
      const { skipValidation, ...body } = args;
      const report = validateWorkflow(body);
      if (!report.valid && !skipValidation) {
        return { created: false, validation: report };
      }
      const workflow = await client.request<N8nWorkflow>("POST", "/workflows", {
        body: { ...body, settings: body.settings ?? {} },
      });
      return {
        created: true,
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        validation: report,
      };
    },
  }),

  defineTool({
    name: "update_workflow",
    description:
      "Update a workflow partially: fetches the current version, merges only the fields you pass (name, nodes, connections, settings), validates offline and PUTs the result. Pass full nodes/connections arrays when changing them — they replace the existing ones.",
    schema: z.object({
      id: z.string().describe("Workflow ID"),
      name: z.string().optional(),
      nodes: z.array(workflowNodeSchema).optional(),
      connections: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional(),
      skipValidation: z.boolean().default(false).describe("Update even if offline validation finds errors"),
    }),
    handler: async (args, client) => {
      const current = await client.request<N8nWorkflow>("GET", `/workflows/${encodeURIComponent(args.id)}`, {
        query: { excludePinnedData: true },
      });
      const merged = {
        ...toWritableWorkflow(current),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.nodes !== undefined ? { nodes: args.nodes } : {}),
        ...(args.connections !== undefined ? { connections: args.connections } : {}),
        ...(args.settings !== undefined ? { settings: args.settings } : {}),
      };
      const report = validateWorkflow(merged);
      if (!report.valid && !args.skipValidation) {
        return { updated: false, validation: report };
      }
      const workflow = await client.request<N8nWorkflow>("PUT", `/workflows/${encodeURIComponent(args.id)}`, {
        body: merged,
      });
      return { updated: true, id: workflow.id, name: workflow.name, validation: report };
    },
  }),

  defineTool({
    name: "delete_workflow",
    description: "Permanently delete a workflow by ID. This cannot be undone — consider deactivate_workflow instead if you only want to stop it.",
    schema: z.object({ id: z.string().describe("Workflow ID") }),
    handler: async (args, client) => {
      const workflow = await client.request<N8nWorkflow>("DELETE", `/workflows/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id, name: workflow.name };
    },
  }),

  defineTool({
    name: "activate_workflow",
    description: "Activate a workflow so its triggers (webhooks, schedules, queue consumers) start running.",
    schema: z.object({ id: z.string().describe("Workflow ID") }),
    handler: async (args, client) => {
      const workflow = await client.request<N8nWorkflow>("POST", `/workflows/${encodeURIComponent(args.id)}/activate`);
      return { id: workflow.id, name: workflow.name, active: workflow.active };
    },
  }),

  defineTool({
    name: "deactivate_workflow",
    description: "Deactivate a workflow — triggers stop firing but the workflow and its history are kept.",
    schema: z.object({ id: z.string().describe("Workflow ID") }),
    handler: async (args, client) => {
      const workflow = await client.request<N8nWorkflow>("POST", `/workflows/${encodeURIComponent(args.id)}/deactivate`);
      return { id: workflow.id, name: workflow.name, active: workflow.active };
    },
  }),

  defineTool({
    name: "transfer_workflow",
    description: "Transfer a workflow to another project (requires the Projects feature on the instance).",
    schema: z.object({
      id: z.string().describe("Workflow ID"),
      destinationProjectId: z.string().describe("Target project ID (see list_projects)"),
    }),
    handler: async (args, client) => {
      await client.request("PUT", `/workflows/${encodeURIComponent(args.id)}/transfer`, {
        body: { destinationProjectId: args.destinationProjectId },
      });
      return { transferred: true, id: args.id, destinationProjectId: args.destinationProjectId };
    },
  }),

  defineTool({
    name: "search_workflows",
    description:
      "Search workflows by free text across name, node names and node types (client-side over the listing — finds e.g. every workflow using a given node type or touching a given service).",
    schema: z.object({
      query: z.string().min(1).describe("Case-insensitive text to match against workflow name, node names and node types"),
      active: z.boolean().optional().describe("Restrict to active/inactive workflows"),
      maxScan: z.number().int().min(1).max(1000).default(500).describe("Max workflows to scan"),
    }),
    handler: async (args, client) => {
      const needle = args.query.toLowerCase();
      const workflows = await client.paginate<N8nWorkflow>(
        "/workflows",
        { active: args.active, excludePinnedData: true },
        args.maxScan
      );
      const matches = workflows
        .map((w) => {
          const matchedNodes = (w.nodes ?? []).filter(
            (n) =>
              n.name.toLowerCase().includes(needle) || n.type.toLowerCase().includes(needle)
          );
          const nameMatch = w.name.toLowerCase().includes(needle);
          if (!nameMatch && matchedNodes.length === 0) return null;
          return {
            id: w.id,
            name: w.name,
            active: w.active,
            matchedOn: [
              ...(nameMatch ? ["name"] : []),
              ...matchedNodes.map((n) => `node: ${n.name} (${n.type})`),
            ],
          };
        })
        .filter(Boolean);
      return { scanned: workflows.length, found: matches.length, matches };
    },
  }),

  defineTool({
    name: "clone_workflow",
    description:
      "Duplicate a workflow: fetches the source and creates an inactive copy (same nodes, connections, settings and credential references) under a new name. Useful for safe experimentation on production workflows.",
    schema: z.object({
      id: z.string().describe("Source workflow ID"),
      newName: z.string().optional().describe("Name for the copy (default: '<source name> (copy)')"),
    }),
    handler: async (args, client) => {
      const source = await client.request<N8nWorkflow>(
        "GET",
        `/workflows/${encodeURIComponent(args.id)}`,
        { query: { excludePinnedData: true } }
      );
      const body = {
        ...toWritableWorkflow(source),
        name: args.newName ?? `${source.name} (copy)`,
      };
      const clone = await client.request<N8nWorkflow>("POST", "/workflows", { body });
      return {
        cloned: true,
        sourceId: args.id,
        id: clone.id,
        name: clone.name,
        active: clone.active,
        hint: "The copy is inactive — use activate_workflow when ready.",
      };
    },
  }),

  defineTool({
    name: "set_workflows_active_by_tag",
    description:
      "Bulk activate or deactivate every workflow carrying a tag — an operational kill switch (e.g. deactivate everything tagged 'client-x'). Runs as a dry run by default; set dryRun=false to apply. Workflows already in the desired state are skipped.",
    annotations: { destructiveHint: true },
    schema: z.object({
      tag: z.string().min(1).describe("Tag name (see list_tags)"),
      active: z.boolean().describe("Desired state: true = activate, false = deactivate"),
      dryRun: z.boolean().default(true).describe("Preview affected workflows without changing them"),
    }),
    handler: async (args, client) => {
      const tagged = await client.paginate<N8nWorkflow>(
        "/workflows",
        { tags: args.tag, excludePinnedData: true },
        1000
      );
      const targets = tagged.filter((w) => w.active !== args.active);
      const skipped = tagged.length - targets.length;

      if (args.dryRun) {
        return {
          dryRun: true,
          wouldChange: targets.map((w) => ({ id: w.id, name: w.name, active: w.active })),
          alreadyInDesiredState: skipped,
          hint: targets.length ? "Call again with dryRun=false to apply." : undefined,
        };
      }

      const changed: Array<{ id: string; name: string }> = [];
      const failed: Array<{ id: string; name: string; error: string }> = [];
      for (const workflow of targets) {
        try {
          await client.request(
            "POST",
            `/workflows/${encodeURIComponent(workflow.id)}/${args.active ? "activate" : "deactivate"}`
          );
          changed.push({ id: workflow.id, name: workflow.name });
        } catch (error) {
          failed.push({
            id: workflow.id,
            name: workflow.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        changed,
        alreadyInDesiredState: skipped,
        failed: failed.length ? failed : undefined,
      };
    },
  }),

  defineTool({
    name: "validate_workflow_json",
    description:
      "Validate a workflow JSON offline (no API call): structure, unique node names, connection integrity, orphan nodes, {{ }} expression syntax, webhook `.body` access, Code node return format and hardcoded secrets. Run before create_workflow/update_workflow.",
    schema: z.object({
      workflow: z
        .object({
          name: z.string().optional(),
          nodes: z.array(z.record(z.unknown())).optional(),
          connections: z.record(z.unknown()).optional(),
        })
        .passthrough()
        .describe("The workflow JSON to validate"),
    }),
    handler: async (args) => validateWorkflow(args.workflow as Parameters<typeof validateWorkflow>[0]),
  }),
];
