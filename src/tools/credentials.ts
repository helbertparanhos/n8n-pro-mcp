import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import type { N8nCredential } from "../types.js";

export const credentialTools: ToolDef[] = [
  defineTool({
    name: "create_credential",
    description:
      "Create a credential on the instance. Use get_credential_schema first to see which fields the credential type requires. The n8n public API never returns credential secrets — only metadata.",
    schema: z.object({
      name: z.string().min(1).describe("Display name for the credential"),
      type: z.string().min(1).describe("Credential type name, e.g. 'slackApi', 'httpHeaderAuth'"),
      data: z.record(z.unknown()).describe("Credential fields as required by the type's schema"),
    }),
    handler: async (args, client) => {
      const credential = await client.request<N8nCredential>("POST", "/credentials", {
        body: { name: args.name, type: args.type, data: args.data },
      });
      return { created: true, id: credential.id, name: credential.name, type: credential.type };
    },
  }),

  defineTool({
    name: "delete_credential",
    description: "Delete a credential by ID. Workflows that reference it will fail until reassigned.",
    schema: z.object({ id: z.string().describe("Credential ID") }),
    handler: async (args, client) => {
      const credential = await client.request<N8nCredential>("DELETE", `/credentials/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id, name: credential.name };
    },
  }),

  defineTool({
    name: "get_credential_schema",
    description:
      "Get the JSON schema of a credential type — which fields it needs (e.g. 'slackApi' → accessToken). Use before create_credential.",
    schema: z.object({
      credentialTypeName: z.string().min(1).describe("Credential type name, e.g. 'githubApi'"),
    }),
    handler: (args, client) =>
      client.request("GET", `/credentials/schema/${encodeURIComponent(args.credentialTypeName)}`),
  }),

  defineTool({
    name: "transfer_credential",
    description: "Transfer a credential to another project (requires the Projects feature).",
    schema: z.object({
      id: z.string().describe("Credential ID"),
      destinationProjectId: z.string().describe("Target project ID (see list_projects)"),
    }),
    handler: async (args, client) => {
      await client.request("PUT", `/credentials/${encodeURIComponent(args.id)}/transfer`, {
        body: { destinationProjectId: args.destinationProjectId },
      });
      return { transferred: true, id: args.id, destinationProjectId: args.destinationProjectId };
    },
  }),
];
