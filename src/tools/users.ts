import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import type { N8nUser } from "../types.js";

export const userTools: ToolDef[] = [
  defineTool({
    name: "list_users",
    description: "List users of the instance with their global roles (requires owner API key).",
    schema: z.object({
      includeRole: z.boolean().default(true).describe("Include each user's global role"),
      projectId: z.string().optional().describe("Filter to members of a project"),
      maxItems: z.number().int().min(1).max(1000).default(200).describe("Max users to return"),
    }),
    handler: (args, client) =>
      client.paginate<N8nUser>(
        "/users",
        { includeRole: args.includeRole, projectId: args.projectId },
        args.maxItems
      ),
  }),

  defineTool({
    name: "get_user",
    description: "Get one user by ID or email address.",
    schema: z.object({
      idOrEmail: z.string().describe("User ID or email"),
      includeRole: z.boolean().default(true).describe("Include the user's global role"),
    }),
    handler: (args, client) =>
      client.request<N8nUser>("GET", `/users/${encodeURIComponent(args.idOrEmail)}`, {
        query: { includeRole: args.includeRole },
      }),
  }),

  defineTool({
    name: "create_user",
    description:
      "Invite a new user to the instance with a global role. Returns the invite acceptance URL when email is not configured on the instance.",
    schema: z.object({
      email: z.string().email().describe("Email of the user to invite"),
      role: z.enum(["global:admin", "global:member"]).default("global:member").describe("Global role"),
    }),
    handler: (args, client) =>
      client.request("POST", "/users", { body: [{ email: args.email, role: args.role }] }),
  }),

  defineTool({
    name: "delete_user",
    description:
      "Permanently remove a user from the instance by ID or email — cannot be undone; the user loses access immediately.",
    schema: z.object({ idOrEmail: z.string().describe("User ID or email") }),
    handler: async (args, client) => {
      await client.request("DELETE", `/users/${encodeURIComponent(args.idOrEmail)}`);
      return { deleted: true, user: args.idOrEmail };
    },
  }),

  defineTool({
    name: "change_user_role",
    description: "Change a user's global role (admin ↔ member). The instance owner role cannot be reassigned.",
    schema: z.object({
      idOrEmail: z.string().describe("User ID or email"),
      newRole: z.enum(["global:admin", "global:member"]).describe("New global role"),
    }),
    handler: async (args, client) => {
      await client.request("PATCH", `/users/${encodeURIComponent(args.idOrEmail)}/role`, {
        body: { newRoleName: args.newRole },
      });
      return { updated: true, user: args.idOrEmail, role: args.newRole };
    },
  }),
];
