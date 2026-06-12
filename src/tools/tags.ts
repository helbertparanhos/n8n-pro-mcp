import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import type { N8nTag } from "../types.js";

export const tagTools: ToolDef[] = [
  defineTool({
    name: "list_tags",
    description: "List all tags on the instance with their IDs (IDs are needed by set_workflow_tags).",
    schema: z.object({
      maxItems: z.number().int().min(1).max(1000).default(200).describe("Max tags to return"),
    }),
    handler: (args, client) => client.paginate<N8nTag>("/tags", {}, args.maxItems),
  }),

  defineTool({
    name: "create_tag",
    description: "Create a new tag.",
    schema: z.object({ name: z.string().min(1).describe("Tag name") }),
    handler: (args, client) => client.request<N8nTag>("POST", "/tags", { body: { name: args.name } }),
  }),

  defineTool({
    name: "update_tag",
    description: "Rename a tag by ID (all workflows using it see the new name).",
    schema: z.object({
      id: z.string().describe("Tag ID"),
      name: z.string().min(1).describe("New tag name"),
    }),
    handler: (args, client) =>
      client.request<N8nTag>("PUT", `/tags/${encodeURIComponent(args.id)}`, { body: { name: args.name } }),
  }),

  defineTool({
    name: "delete_tag",
    description: "Delete a tag by ID (removes it from every workflow; the workflows themselves are untouched).",
    schema: z.object({ id: z.string().describe("Tag ID") }),
    handler: async (args, client) => {
      const tag = await client.request<N8nTag>("DELETE", `/tags/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id, name: tag.name };
    },
  }),

  defineTool({
    name: "get_workflow_tags",
    description: "List the tags attached to a workflow.",
    schema: z.object({ workflowId: z.string().describe("Workflow ID") }),
    handler: (args, client) => client.request<N8nTag[]>("GET", `/workflows/${encodeURIComponent(args.workflowId)}/tags`),
  }),

  defineTool({
    name: "set_workflow_tags",
    description:
      "Replace the tags of a workflow. Accepts tag NAMES — resolves them to IDs automatically and, with createMissing=true, creates tags that don't exist yet. Pass an empty list to remove all tags.",
    schema: z.object({
      workflowId: z.string().describe("Workflow ID"),
      tagNames: z.array(z.string().min(1)).describe("Full desired set of tag names (replaces current tags)"),
      createMissing: z.boolean().default(true).describe("Create tags that don't exist yet"),
    }),
    handler: async (args, client) => {
      const existing = await client.paginate<N8nTag>("/tags", {}, 1000);
      const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));

      const tagIds: string[] = [];
      const created: string[] = [];
      const missing: string[] = [];
      for (const name of args.tagNames) {
        const found = byName.get(name.toLowerCase());
        if (found) {
          tagIds.push(found.id);
        } else if (args.createMissing) {
          const tag = await client.request<N8nTag>("POST", "/tags", { body: { name } });
          tagIds.push(tag.id);
          created.push(name);
        } else {
          missing.push(name);
        }
      }
      if (missing.length) {
        return {
          updated: false,
          error: `Tags not found (createMissing=false): ${missing.join(", ")}`,
        };
      }

      const result = await client.request<N8nTag[]>("PUT", `/workflows/${encodeURIComponent(args.workflowId)}/tags`, {
        body: tagIds.map((id) => ({ id })),
      });
      return { updated: true, workflowId: args.workflowId, tags: result, createdTags: created };
    },
  }),
];
