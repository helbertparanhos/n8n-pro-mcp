import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import type { N8nVariable } from "../types.js";

export const variableTools: ToolDef[] = [
  defineTool({
    name: "list_variables",
    description:
      "List instance variables (accessible in workflows via $vars.<key>). Requires a licensed n8n plan with the Variables feature.",
    schema: z.object({
      maxItems: z.number().int().min(1).max(1000).default(200).describe("Max variables to return"),
    }),
    handler: (args, client) => client.paginate<N8nVariable>("/variables", {}, args.maxItems),
  }),

  defineTool({
    name: "create_variable",
    description: "Create an instance variable (then available in workflows as $vars.<key>).",
    schema: z.object({
      key: z.string().min(1).describe("Variable key (letters, numbers, underscores)"),
      value: z.string().describe("Variable value (always stored as string)"),
    }),
    handler: async (args, client) => {
      await client.request("POST", "/variables", { body: { key: args.key, value: args.value } });
      return { created: true, key: args.key };
    },
  }),

  defineTool({
    name: "update_variable",
    description: "Update an existing variable's key/value by variable ID (see list_variables for IDs).",
    schema: z.object({
      id: z.string().describe("Variable ID"),
      key: z.string().min(1).describe("Variable key"),
      value: z.string().describe("New value"),
    }),
    handler: async (args, client) => {
      await client.request("PUT", `/variables/${encodeURIComponent(args.id)}`, {
        body: { key: args.key, value: args.value },
      });
      return { updated: true, id: args.id, key: args.key };
    },
  }),

  defineTool({
    name: "delete_variable",
    description:
      "Permanently delete a variable by ID — cannot be undone. Workflows reading $vars.<key> will get undefined afterwards.",
    schema: z.object({ id: z.string().describe("Variable ID") }),
    handler: async (args, client) => {
      await client.request("DELETE", `/variables/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id };
    },
  }),
];
