import type { N8nWorkflowNode } from "../types.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  node?: string;
  rule: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: string;
}

interface WorkflowLike {
  name?: unknown;
  nodes?: unknown;
  connections?: unknown;
  settings?: unknown;
}

const NON_EXECUTABLE_TYPES = new Set(["n8n-nodes-base.stickyNote"]);
const WEBHOOK_TRIGGER_TYPES = new Set([
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.formTrigger",
]);
const CODE_NODE_TYPES = new Set(["n8n-nodes-base.code", "n8n-nodes-base.function"]);

/**
 * Offline validation of a workflow JSON before sending it to the n8n API.
 * Rules distilled from common n8n failure modes: malformed {{ }} expressions,
 * webhook data accessed without `.body`, Code nodes missing returns,
 * connections pointing at nonexistent nodes, orphan nodes.
 */
export function validateWorkflow(workflow: WorkflowLike): ValidationReport {
  const issues: ValidationIssue[] = [];

  const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as N8nWorkflowNode[]) : null;
  if (!workflow.name || typeof workflow.name !== "string") {
    issues.push({
      severity: "error",
      rule: "structure",
      message: "Workflow must have a non-empty string `name`.",
    });
  }
  if (!nodes || nodes.length === 0) {
    issues.push({
      severity: "error",
      rule: "structure",
      message: "Workflow must have a non-empty `nodes` array.",
    });
    return buildReport(issues);
  }
  if (typeof workflow.connections !== "object" || workflow.connections === null) {
    issues.push({
      severity: "error",
      rule: "structure",
      message: "Workflow must have a `connections` object (use {} only for single-node workflows).",
    });
  }

  const nodeNames = new Set<string>();
  for (const node of nodes) {
    if (!node.name || !node.type) {
      issues.push({
        severity: "error",
        rule: "structure",
        message: `Every node needs \`name\` and \`type\` (offender: ${JSON.stringify(node.name ?? node.type ?? "?")}).`,
      });
      continue;
    }
    if (nodeNames.has(node.name)) {
      issues.push({
        severity: "error",
        node: node.name,
        rule: "structure",
        message: `Duplicate node name "${node.name}" — node names must be unique.`,
      });
    }
    nodeNames.add(node.name);
  }

  checkConnections(workflow.connections as Record<string, unknown>, nodeNames, nodes, issues);

  const hasWebhookTrigger = nodes.some((n) => WEBHOOK_TRIGGER_TYPES.has(n.type));
  for (const node of nodes) {
    checkExpressions(node, issues, hasWebhookTrigger);
    if (CODE_NODE_TYPES.has(node.type)) checkCodeNode(node, issues);
    checkInlineSecrets(node, issues);
  }

  return buildReport(issues);
}

function checkConnections(
  connections: Record<string, unknown> | null | undefined,
  nodeNames: Set<string>,
  nodes: N8nWorkflowNode[],
  issues: ValidationIssue[]
): void {
  if (!connections || typeof connections !== "object") return;

  const connectedNodes = new Set<string>(Object.keys(connections));
  for (const [source, outputs] of Object.entries(connections)) {
    if (!nodeNames.has(source)) {
      issues.push({
        severity: "error",
        rule: "connections",
        message: `Connection source "${source}" does not match any node name (names are case-sensitive).`,
      });
    }
    if (typeof outputs !== "object" || outputs === null) continue;
    for (const branches of Object.values(outputs as Record<string, unknown>)) {
      if (!Array.isArray(branches)) continue;
      for (const branch of branches.flat(2)) {
        const target = (branch as { node?: string } | null)?.node;
        if (!target) continue;
        connectedNodes.add(target);
        if (!nodeNames.has(target)) {
          issues.push({
            severity: "error",
            rule: "connections",
            message: `Connection target "${target}" (from "${source}") does not match any node name.`,
          });
        }
      }
    }
  }

  if (nodes.length > 1) {
    for (const node of nodes) {
      if (NON_EXECUTABLE_TYPES.has(node.type) || node.disabled) continue;
      if (!connectedNodes.has(node.name)) {
        issues.push({
          severity: "warning",
          node: node.name,
          rule: "connections",
          message: `Node "${node.name}" is not connected to anything — it will never run.`,
        });
      }
    }
  }
}

function checkExpressions(
  node: N8nWorkflowNode,
  issues: ValidationIssue[],
  hasWebhookTrigger: boolean
): void {
  for (const value of stringValues(node.parameters)) {
    if (!value.includes("{{") && !value.includes("}}")) continue;

    const opens = (value.match(/\{\{/g) ?? []).length;
    const closes = (value.match(/\}\}/g) ?? []).length;
    if (opens !== closes) {
      issues.push({
        severity: "error",
        node: node.name,
        rule: "expression-syntax",
        message: `Unbalanced {{ }} in expression: ${truncate(value)}`,
      });
    }
    if (/\{\{\{|\}\}\}/.test(value)) {
      issues.push({
        severity: "error",
        node: node.name,
        rule: "expression-syntax",
        message: `Triple braces are invalid n8n syntax: ${truncate(value)}`,
      });
    }
    if (
      hasWebhookTrigger &&
      /\{\{\s*\$json\.(?!body\b|headers\b|params\b|query\b)/.test(value)
    ) {
      issues.push({
        severity: "warning",
        node: node.name,
        rule: "webhook-body",
        message:
          `Expression reads "$json.<field>" but webhook payloads arrive under "$json.body.<field>" — ` +
          `verify this node is not consuming webhook output directly: ${truncate(value)}`,
      });
    }
  }
}

function checkCodeNode(node: N8nWorkflowNode, issues: ValidationIssue[]): void {
  const code = [node.parameters?.jsCode, node.parameters?.functionCode, node.parameters?.code]
    .find((c): c is string => typeof c === "string");
  if (!code) return;

  if (!/\breturn\b/.test(code)) {
    issues.push({
      severity: "error",
      node: node.name,
      rule: "code-node",
      message:
        "Code node has no `return` statement — it must return an array like `return [{json: {...}}]`.",
    });
  }
  // Only unambiguous n8n expression syntax ({{ $json... }}) is an error —
  // generic {{ }} may be legitimate templating (Handlebars/Mustache) in a string.
  if (/\{\{\s*\$(json|node|input|now|env|vars|items)\b/.test(code)) {
    issues.push({
      severity: "error",
      node: node.name,
      rule: "code-node",
      message:
        "Code node contains {{ }} expression syntax — inside Code nodes use plain JavaScript ($json.field, not {{$json.field}}).",
    });
  }
}

function checkInlineSecrets(node: N8nWorkflowNode, issues: ValidationIssue[]): void {
  for (const [key, value] of Object.entries(flatten(node.parameters))) {
    if (typeof value !== "string" || value.length < 12) continue;
    if (/(api[-_]?key|apikey|secret|password|token)/i.test(key) && !value.includes("{{")) {
      issues.push({
        severity: "warning",
        node: node.name,
        rule: "inline-secret",
        message:
          `Parameter "${key}" looks like a hardcoded secret — store it in n8n Credentials instead of node parameters.`,
      });
    }
  }
}

function buildReport(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary:
      errors.length === 0
        ? `Valid — 0 errors, ${warnings.length} warning(s).`
        : `Invalid — ${errors.length} error(s), ${warnings.length} warning(s). Fix errors before create/update.`,
  };
}

function* stringValues(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* stringValues(item);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) yield* stringValues(item);
  }
}

function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "object" && item !== null) {
      Object.assign(out, flatten(item, path));
    } else {
      out[path] = item;
    }
  }
  return out;
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
