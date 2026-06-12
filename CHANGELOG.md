# Changelog

## [1.0.0] - 2026-06-12

### Added
- 51 tools over the n8n public API v1, in 8 categories:
  - **Workflows (12)** — CRUD with safe partial update (fetch+merge), clone, transfer, free-text search, bulk activate/deactivate by tag (dry run), offline `validate_workflow_json`
  - **Executions (10)** — list/get/delete/retry, queue-mode live view (`list_running_executions`), `run_webhook` (production/test), `wait_for_execution`, `summarize_execution_error`, `prune_executions` (dry run), `get_execution_stats`
  - **Tags (6)** — CRUD + `set_workflow_tags` by name with auto-creation
  - **Credentials (4)** — create, delete, schema, transfer (write-only secrets)
  - **Variables (4)** — CRUD (licensed feature)
  - **Projects (7)** — CRUD + member management (licensed feature)
  - **Users (5)** — list, get, invite, delete, role change
  - **System (3)** — `check_health` (healthz + readiness + API auth), `generate_audit`, `pull_source_control`
- Cursor pagination with empty-page guard, exponential-backoff retry on GETs only (writes/webhooks never retried)
- Offline workflow validation: `{{ }}` expression syntax, webhook `.body` access, Code node return format, orphan connections, hardcoded secrets
- 37 unit tests (`node:test`, zero extra deps), GitHub Actions CI (build + test + audit)
- Configuration for Claude Code, Cursor and Claude Desktop

### Fixed
- `run_webhook` rejects `payload` combined with `method: GET` at the schema level (clear validation error instead of a misleading network-hint runtime error)

### Security
- API key sent only via `X-N8N-API-KEY` header, never logged or placed in query strings
- Webhook response headers allow-listed (`set-cookie`/`authorization` stripped); webhook path guarded against traversal/scheme override
- Destructive tools (`prune_executions`, `set_workflows_active_by_tag`) default to `dryRun: true`
