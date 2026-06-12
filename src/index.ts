#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { N8nClient } from "./client.js";
import { loadDotEnv, readPackageVersion } from "./env.js";
import { buildHandlers, buildToolList } from "./tools/index.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  loadDotEnv(join(projectRoot, ".env"));
  const client = N8nClient.fromEnv();
  const tools = buildToolList();
  const handlers = buildHandlers(client);

  const server = new Server(
    { name: "n8n-pro-mcp", version: readPackageVersion(join(projectRoot, "package.json")) },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Object.hasOwn keeps prototype members (toString, constructor, ...) from
    // masquerading as tools.
    if (!Object.hasOwn(handlers, request.params.name)) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}. Available tools: ${Object.keys(handlers).join(", ")}`
      );
    }
    return handlers[request.params.name](request.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`n8n-pro-mcp ready — ${tools.length} tools, instance: ${client.instanceUrl}`);
}

main().catch((error) => {
  console.error(`n8n-pro-mcp failed to start: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
