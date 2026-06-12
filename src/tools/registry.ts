import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { N8nApiError, type N8nClient } from "../client.js";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<S>, client: N8nClient) => Promise<unknown>;
}

export function defineTool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

const READ_ONLY_PREFIX = /^(list|get|search|check|validate)_/;
const DESTRUCTIVE_PREFIX = /^delete_/;

function resolveAnnotations(def: ToolDef): ToolAnnotations | undefined {
  if (def.annotations) return def.annotations;
  if (READ_ONLY_PREFIX.test(def.name)) return { readOnlyHint: true };
  if (DESTRUCTIVE_PREFIX.test(def.name)) return { destructiveHint: true };
  return undefined;
}

export function toMcpTool(def: ToolDef): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
} {
  const annotations = resolveAnnotations(def);
  return {
    name: def.name,
    description: def.description,
    inputSchema: zodToJsonSchema(def.schema, { $refStrategy: "none" }) as Record<string, unknown>,
    ...(annotations ? { annotations } : {}),
  };
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function wrapHandler(
  def: ToolDef,
  client: N8nClient
): (rawArgs: unknown) => Promise<ToolResult> {
  return async (rawArgs) => {
    const parsed = def.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new McpError(ErrorCode.InvalidParams, `${def.name}: invalid arguments — ${details}`);
    }

    try {
      const result = await def.handler(parsed.data, client);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message =
        error instanceof N8nApiError
          ? error.detailed()
          : error instanceof Error
            ? error.message
            : String(error);
      // Execution failures go back as a tool result (isError), not a protocol
      // error, so the model sees the actionable hint and can self-correct.
      return {
        content: [{ type: "text", text: `${def.name} failed: ${message}` }],
        isError: true,
      };
    }
  };
}
