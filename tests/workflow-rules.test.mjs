import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow } from "../dist/validation/workflow-rules.js";

function webhookWorkflow(overrides = {}) {
  return {
    name: "Test",
    nodes: [
      { name: "Webhook", type: "n8n-nodes-base.webhook", parameters: {} },
      {
        name: "Set",
        type: "n8n-nodes-base.set",
        parameters: { value: "={{$json.body.email}}" },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Set", type: "main", index: 0 }]] },
    },
    ...overrides,
  };
}

test("valid workflow passes", () => {
  const report = validateWorkflow(webhookWorkflow());
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("missing nodes is a structural error", () => {
  const report = validateWorkflow({ name: "Empty", nodes: [], connections: {} });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.rule === "structure"));
});

test("connection to nonexistent node is an error", () => {
  const workflow = webhookWorkflow();
  workflow.connections.Webhook.main[0][0].node = "Ghost";
  const report = validateWorkflow(workflow);
  assert.ok(
    report.errors.some((issue) => issue.rule === "connections" && issue.message.includes("Ghost"))
  );
});

test("duplicate node names are an error", () => {
  const workflow = webhookWorkflow();
  workflow.nodes.push({ name: "Set", type: "n8n-nodes-base.set", parameters: {} });
  const report = validateWorkflow(workflow);
  assert.ok(report.errors.some((issue) => issue.message.includes("Duplicate node name")));
});

test("orphan node is a warning, not an error", () => {
  const workflow = webhookWorkflow();
  workflow.nodes.push({ name: "Lost", type: "n8n-nodes-base.set", parameters: {} });
  const report = validateWorkflow(workflow);
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((issue) => issue.node === "Lost" && issue.rule === "connections"));
});

test("unbalanced braces are an expression-syntax error", () => {
  const workflow = webhookWorkflow();
  workflow.nodes[1].parameters.value = "={{$json.body.email";
  const report = validateWorkflow(workflow);
  assert.ok(report.errors.some((issue) => issue.rule === "expression-syntax"));
});

test("webhook data accessed without .body is a warning", () => {
  const workflow = webhookWorkflow();
  workflow.nodes[1].parameters.value = "={{$json.email}}";
  const report = validateWorkflow(workflow);
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((issue) => issue.rule === "webhook-body"));
});

test("$json.body access does not trigger the webhook warning", () => {
  const report = validateWorkflow(webhookWorkflow());
  assert.equal(report.warnings.filter((issue) => issue.rule === "webhook-body").length, 0);
});

test("code node without return is an error", () => {
  const workflow = webhookWorkflow();
  workflow.nodes.push({
    name: "Code",
    type: "n8n-nodes-base.code",
    parameters: { jsCode: "const x = $json.body.email;" },
  });
  workflow.connections.Set = { main: [[{ node: "Code", type: "main", index: 0 }]] };
  const report = validateWorkflow(workflow);
  assert.ok(report.errors.some((issue) => issue.rule === "code-node"));
});

test("n8n expression syntax inside a code node is an error", () => {
  const workflow = webhookWorkflow();
  workflow.nodes.push({
    name: "Code",
    type: "n8n-nodes-base.code",
    parameters: { jsCode: "return [{json: {email: {{ $json.body.email }} }}];" },
  });
  workflow.connections.Set = { main: [[{ node: "Code", type: "main", index: 0 }]] };
  const report = validateWorkflow(workflow);
  assert.ok(report.errors.some((issue) => issue.rule === "code-node"));
});

test("generic handlebars templating in a code node is NOT flagged", () => {
  const workflow = webhookWorkflow();
  workflow.nodes.push({
    name: "Code",
    type: "n8n-nodes-base.code",
    parameters: { jsCode: 'return [{json: {template: "Hello {{name}}!"}}];' },
  });
  workflow.connections.Set = { main: [[{ node: "Code", type: "main", index: 0 }]] };
  const report = validateWorkflow(workflow);
  assert.equal(report.errors.filter((issue) => issue.rule === "code-node").length, 0);
});

test("hardcoded secret in parameters is a warning", () => {
  const workflow = webhookWorkflow();
  workflow.nodes[1].parameters.apiKey = "sk-1234567890abcdef";
  const report = validateWorkflow(workflow);
  assert.ok(report.warnings.some((issue) => issue.rule === "inline-secret"));
});

test("expression-based secret reference is NOT flagged", () => {
  const workflow = webhookWorkflow();
  workflow.nodes[1].parameters.apiKey = "={{ $vars.MY_API_KEY_LONG_ENOUGH }}";
  const report = validateWorkflow(workflow);
  assert.equal(report.warnings.filter((issue) => issue.rule === "inline-secret").length, 0);
});
