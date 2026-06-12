# n8n Pro MCP ⚙️

> Full-instance management for self-hosted n8n — including queue mode — through the Model Context Protocol. 51 tools covering workflows, executions, tags, credentials, variables, projects, users, security audit, source control and health monitoring.

[![npm version](https://img.shields.io/npm/v/n8n-pro-mcp.svg?style=flat-square)](https://www.npmjs.com/package/n8n-pro-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/helbertparanhos/n8n-pro-mcp?style=flat-square)](https://github.com/helbertparanhos/n8n-pro-mcp/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/helbertparanhos/n8n-pro-mcp?style=flat-square)](https://github.com/helbertparanhos/n8n-pro-mcp/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/helbertparanhos/n8n-pro-mcp?style=flat-square)](https://github.com/helbertparanhos/n8n-pro-mcp/issues)
[![Glama Quality](https://glama.ai/mcp/servers/helbertparanhos/n8n-pro-mcp/badges/score.svg)](https://glama.ai/mcp/servers/helbertparanhos/n8n-pro-mcp)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-000000?style=flat-square)](https://modelcontextprotocol.io/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-D97706?style=flat-square)](https://claude.ai/code)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-4F46E5?style=flat-square)](https://cursor.sh)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Compatible-D97706?style=flat-square)](https://claude.ai/download)

[![Instagram](https://img.shields.io/badge/@helbertparanhos-E4405F?style=flat-square&logo=instagram&logoColor=white)](https://www.instagram.com/helbertparanhos)
[![YouTube](https://img.shields.io/badge/stratacademy-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://www.youtube.com/@stratacademy)
[![LinkedIn](https://img.shields.io/badge/helbert--paranhos-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/helbert-paranhos/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/helbertparanhos)
[![Strat Academy](https://img.shields.io/badge/Strat%20Academy-8B5CF6?style=flat-square)](https://stratacademy.com.br)

`n8n-pro-mcp` connects Claude Code, Claude Desktop, Cursor or any MCP client to your n8n instance via the official [n8n public API v1](https://docs.n8n.io/api/), with automatic cursor pagination, exponential-backoff retry on reads (writes and webhook calls are never retried, so side effects can't duplicate), and offline workflow validation that catches the classic n8n mistakes (malformed `{{ }}` expressions, webhook data accessed without `.body`, Code nodes missing `return [{json: {...}}]`) **before** they reach your instance.

## Why this one?

- **Queue mode first-class** — `list_running_executions` (live queue view), `get_execution_stats` (success rate + average duration per workflow) and `check_health` (healthz, readiness, API auth) were built for instances running `EXECUTIONS_MODE=queue` with workers and webhook processors. `N8N_WEBHOOK_BASE_URL` lets webhook calls target dedicated webhook processors.
- **Complete API v1 coverage** — tags, variables, projects, users, source control and cross-project transfers, beyond the usual workflow/execution CRUD.
- **Offline validation built in** — `validate_workflow_json` checks structure, connection integrity, orphan nodes, expression syntax, webhook `.body` access, Code node return format and hardcoded secrets without any API call. `create_workflow`/`update_workflow` run it automatically and refuse invalid payloads.
- **Safe partial updates** — `update_workflow` fetches the current workflow, merges only what you pass and strips read-only fields, so you never lose nodes by sending an incomplete PUT.
- **Tags by name** — `set_workflow_tags` accepts tag names and creates missing ones; no manual ID juggling.
- **Ops compositions the raw API doesn't have** — `summarize_execution_error` (just the failing node + error, not a giant JSON dump), `prune_executions` (bulk cleanup with dry run), `wait_for_execution` (poll until terminal), `clone_workflow` and `set_workflows_active_by_tag` (tag-based kill switch).

## Installation

```bash
npm install -g n8n-pro-mcp     # or use npx, no install needed
```

From source:

```bash
git clone https://github.com/helbertparanhos/n8n-pro-mcp.git && cd n8n-pro-mcp
npm install
npm run build
```

When running from source, you can copy `.env.example` to `.env` **in the project root** — the server loads it from the package root, not the working directory. When installed via `npx`, set the variables through your MCP client config instead (the `.env` file is not read from the npx cache).

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_API_URL` | ✅ | Base URL of your instance (e.g. `https://n8n.yourdomain.com`) — no `/api/v1` suffix |
| `N8N_API_KEY` | ✅ | API key from n8n → **Settings → n8n API → Create API key** |
| `N8N_WEBHOOK_BASE_URL` | — | Separate base URL for webhook calls (queue mode with dedicated webhook processors) |
| `N8N_API_TIMEOUT_MS` | — | Per-request timeout in ms (default `30000`) |
| `N8N_MAX_RETRIES` | — | Retries on 429/5xx/network errors — applied to GET requests only, never to writes or webhook calls (default `3`, `0` disables) |

### Claude Code

```bash
claude mcp add n8n-pro --env N8N_API_URL=https://n8n.yourdomain.com --env N8N_API_KEY=your-key -- npx -y n8n-pro-mcp
```

Or in `.claude/settings.json` / `.mcp.json`:

```json
{
  "mcpServers": {
    "n8n-pro": {
      "command": "npx",
      "args": ["-y", "n8n-pro-mcp"],
      "env": {
        "N8N_API_URL": "https://n8n.yourdomain.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "n8n-pro": {
      "command": "npx",
      "args": ["-y", "n8n-pro-mcp"],
      "env": {
        "N8N_API_URL": "https://n8n.yourdomain.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

Same JSON block in Cursor's MCP settings (`.cursor/mcp.json`).

## Tools (51)

### Workflows (12)

| Tool | Description |
|------|-------------|
| `list_workflows` | List with filters (active, tags, project, name) + auto pagination |
| `get_workflow` | Full JSON or lightweight summary of one workflow |
| `create_workflow` | Create from JSON, with automatic offline validation |
| `update_workflow` | Partial update — fetch, merge, validate, PUT |
| `delete_workflow` | Permanently delete |
| `activate_workflow` / `deactivate_workflow` | Toggle triggers |
| `transfer_workflow` | Move between projects |
| `search_workflows` | Free-text search across names, node names and node types |
| `clone_workflow` | Duplicate a workflow as an inactive copy |
| `set_workflows_active_by_tag` | Bulk activate/deactivate by tag, with dry run |
| `validate_workflow_json` | Offline validation, no API call |

### Executions (10)

| Tool | Description |
|------|-------------|
| `list_executions` | Filter by status/workflow/project, with durations |
| `get_execution` | Summary or full node-level run data for debugging |
| `delete_execution` | Remove an execution record |
| `retry_execution` | Retry a failed/stopped execution |
| `list_running_executions` | **Queue-mode live view** of running/queued executions |
| `run_webhook` | Trigger workflows via production or test webhook |
| `wait_for_execution` | Poll an execution until it reaches a terminal state |
| `summarize_execution_error` | Failing node + error message only — no giant JSON dump |
| `prune_executions` | Bulk-delete old execution records, dry run by default |
| `get_execution_stats` | Success rate + avg duration per workflow over a sample |

### Tags (6)

`list_tags`, `create_tag`, `update_tag`, `delete_tag`, `get_workflow_tags`, `set_workflow_tags` (by name, auto-creates missing tags).

### Credentials (4)

`create_credential`, `delete_credential`, `get_credential_schema`, `transfer_credential`. Secrets are write-only — the n8n API never returns credential data.

### Variables (4)

`list_variables`, `create_variable`, `update_variable`, `delete_variable` (licensed feature).

### Projects (7)

`list_projects`, `create_project`, `update_project`, `delete_project`, plus member management: `add_user_to_project`, `remove_user_from_project`, `change_user_project_role` (licensed feature).

### Users (5)

`list_users`, `get_user`, `create_user` (invite), `delete_user`, `change_user_role`.

### System (3)

| Tool | Description |
|------|-------------|
| `check_health` | healthz + readiness (DB) + API auth, with a plain-language summary |
| `generate_audit` | n8n's built-in security audit (credentials, database, nodes, filesystem, instance) |
| `pull_source_control` | Pull from the connected git repository |

## Queue mode playbook

With `EXECUTIONS_MODE=queue` (main + workers + Redis):

1. `check_health` — confirms the main process and DB are up.
2. `list_running_executions` — what is actually in flight right now; a growing list with old `startedAt` values means workers are starved or stuck.
3. `get_execution_stats` — which workflows fail or crawl; sorted worst-first by success rate.
4. `run_webhook` with `N8N_WEBHOOK_BASE_URL` pointing at your webhook processors to test the production ingestion path end to end.

## Development

```bash
npm test             # build + unit tests (validation rules, client helpers, .env parser)
npm run watch        # incremental compile
npm run inspector    # interactive testing with @modelcontextprotocol/inspector
```

CI (GitHub Actions) runs build, tests and `npm audit` on every push and PR.

## Requirements

- Node.js ≥ 18
- n8n instance with the public API enabled (`N8N_PUBLIC_API_DISABLED` not set) and an API key
- Variables, projects and source-control tools require the corresponding licensed n8n features

## 👤 Author

Created by **[Helbert Paranhos](https://github.com/helbertparanhos)** at **[Strat Academy](https://stratacademy.com.br)**.

[![Instagram](https://img.shields.io/badge/@helbertparanhos-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/helbertparanhos)
[![YouTube](https://img.shields.io/badge/stratacademy-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@stratacademy)
[![LinkedIn](https://img.shields.io/badge/helbert--paranhos-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/helbert-paranhos/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/helbertparanhos)

If this project helped you, consider starring ⭐ the repository and following **[Strat Academy](https://stratacademy.com.br)** for more AI automation tooling.

## 📄 License

MIT © [Helbert Paranhos](https://github.com/helbertparanhos) / [Strat Academy](https://stratacademy.com.br) — see [LICENSE](LICENSE).
