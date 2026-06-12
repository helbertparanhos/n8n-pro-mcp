import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl, filterResponseHeaders, N8nApiError } from "../dist/client.js";

test("buildUrl appends defined query params and skips undefined", () => {
  const url = buildUrl("https://n8n.example.com/api/v1/executions", {
    status: "error",
    workflowId: undefined,
    limit: 100,
    includeData: false,
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("status"), "error");
  assert.equal(parsed.searchParams.get("limit"), "100");
  assert.equal(parsed.searchParams.get("includeData"), "false");
  assert.equal(parsed.searchParams.has("workflowId"), false);
});

test("buildUrl without query returns the base untouched", () => {
  const base = "https://n8n.example.com/api/v1/tags";
  assert.equal(buildUrl(base), base);
});

test("filterResponseHeaders keeps only the allowlist", () => {
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": "42",
    date: "Mon, 01 Jun 2026 00:00:00 GMT",
    "set-cookie": "session=secret",
    authorization: "Bearer token",
    "x-powered-by": "n8n",
  });
  const filtered = filterResponseHeaders(headers);
  assert.deepEqual(Object.keys(filtered).sort(), ["content-length", "content-type", "date"]);
  assert.equal(filtered["content-type"], "application/json");
});

test("N8nApiError.detailed includes the hint when present", () => {
  const error = new N8nApiError("boom", 401, "check your key");
  assert.equal(error.detailed(), "boom — Hint: check your key");
  const bare = new N8nApiError("boom");
  assert.equal(bare.detailed(), "boom");
});
