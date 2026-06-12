import { z } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import type { N8nProject } from "../types.js";

export const projectTools: ToolDef[] = [
  defineTool({
    name: "list_projects",
    description:
      "List projects on the instance (requires the Projects feature, available on licensed plans). Project IDs are used by transfer_workflow / transfer_credential and as filters.",
    schema: z.object({
      maxItems: z.number().int().min(1).max(1000).default(200).describe("Max projects to return"),
    }),
    handler: (args, client) => client.paginate<N8nProject>("/projects", {}, args.maxItems),
  }),

  defineTool({
    name: "create_project",
    description: "Create a new team project.",
    schema: z.object({ name: z.string().min(1).describe("Project name") }),
    handler: async (args, client) => {
      const project = await client.request<N8nProject>("POST", "/projects", {
        body: { name: args.name },
      });
      return { created: true, id: project.id, name: project.name };
    },
  }),

  defineTool({
    name: "update_project",
    description: "Rename a project by ID.",
    schema: z.object({
      id: z.string().describe("Project ID"),
      name: z.string().min(1).describe("New project name"),
    }),
    handler: async (args, client) => {
      await client.request("PUT", `/projects/${encodeURIComponent(args.id)}`, { body: { name: args.name } });
      return { updated: true, id: args.id, name: args.name };
    },
  }),

  defineTool({
    name: "delete_project",
    description:
      "Permanently delete a project by ID — cannot be undone. Move its workflows/credentials out first (transfer_workflow / transfer_credential).",
    schema: z.object({ id: z.string().describe("Project ID") }),
    handler: async (args, client) => {
      await client.request("DELETE", `/projects/${encodeURIComponent(args.id)}`);
      return { deleted: true, id: args.id };
    },
  }),

  defineTool({
    name: "add_user_to_project",
    description:
      "Add a user to a project with a project role (admin/editor/viewer). Find user IDs with list_users and project IDs with list_projects.",
    schema: z.object({
      projectId: z.string().describe("Project ID"),
      userId: z.string().describe("User ID (see list_users)"),
      role: z
        .enum(["project:admin", "project:editor", "project:viewer"])
        .default("project:editor")
        .describe("Role of the user inside the project"),
    }),
    handler: async (args, client) => {
      await client.request("POST", `/projects/${encodeURIComponent(args.projectId)}/users`, {
        body: { relations: [{ userId: args.userId, role: args.role }] },
      });
      return { added: true, projectId: args.projectId, userId: args.userId, role: args.role };
    },
  }),

  defineTool({
    name: "remove_user_from_project",
    description: "Remove a user from a project (the user keeps their instance account).",
    schema: z.object({
      projectId: z.string().describe("Project ID"),
      userId: z.string().describe("User ID"),
    }),
    handler: async (args, client) => {
      await client.request(
        "DELETE",
        `/projects/${encodeURIComponent(args.projectId)}/users/${encodeURIComponent(args.userId)}`
      );
      return { removed: true, projectId: args.projectId, userId: args.userId };
    },
  }),

  defineTool({
    name: "change_user_project_role",
    description: "Change a user's role inside a project (admin/editor/viewer).",
    schema: z.object({
      projectId: z.string().describe("Project ID"),
      userId: z.string().describe("User ID"),
      role: z
        .enum(["project:admin", "project:editor", "project:viewer"])
        .describe("New role inside the project"),
    }),
    handler: async (args, client) => {
      await client.request(
        "PATCH",
        `/projects/${encodeURIComponent(args.projectId)}/users/${encodeURIComponent(args.userId)}`,
        { body: { role: args.role } }
      );
      return { updated: true, projectId: args.projectId, userId: args.userId, role: args.role };
    },
  }),
];
