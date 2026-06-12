import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExecutionState,
  collectNodeErrors,
  compactError,
  isPrunable,
} from "../dist/tools/execution-logic.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-12T12:00:00Z");

function execution(overrides = {}) {
  return {
    id: 1,
    finished: true,
    mode: "webhook",
    status: "success",
    workflowId: "wf1",
    startedAt: new Date(NOW - 2 * DAY).toISOString(),
    stoppedAt: new Date(NOW - 2 * DAY + 5000).toISOString(),
    waitTill: null,
    ...overrides,
  };
}

// --- isPrunable -------------------------------------------------------------

test("finished success execution is prunable", () => {
  assert.equal(isPrunable(execution()), true);
});

test("execution paused on a Wait node (stoppedAt set, status waiting) is NEVER prunable", () => {
  const paused = execution({
    status: "waiting",
    finished: false,
    waitTill: new Date(NOW + 5 * DAY).toISOString(),
  });
  assert.equal(isPrunable(paused), false);
});

test("waiting status without waitTill is still not prunable", () => {
  assert.equal(isPrunable(execution({ status: "waiting", finished: false })), false);
});

test("running execution (no stoppedAt) is not prunable", () => {
  assert.equal(isPrunable(execution({ status: "running", finished: false, stoppedAt: null })), false);
});

test("cutoff excludes executions newer than olderThanDays", () => {
  const cutoff = NOW - 7 * DAY;
  assert.equal(isPrunable(execution(), cutoff), false);
  const old = execution({
    startedAt: new Date(NOW - 30 * DAY).toISOString(),
    stoppedAt: new Date(NOW - 30 * DAY + 5000).toISOString(),
  });
  assert.equal(isPrunable(old, cutoff), true);
});

test("error and canceled executions are prunable once stopped", () => {
  assert.equal(isPrunable(execution({ status: "error" })), true);
  assert.equal(isPrunable(execution({ status: "canceled" })), true);
});

// --- classifyExecutionState ---------------------------------------------------

test("terminal statuses classify as terminal", () => {
  for (const status of ["success", "error", "crashed", "canceled"]) {
    assert.equal(classifyExecutionState(execution({ status })), "terminal");
  }
});

test("Wait-paused execution classifies as waiting even with stoppedAt set", () => {
  const paused = execution({
    status: "waiting",
    finished: false,
    waitTill: new Date(NOW + DAY).toISOString(),
  });
  assert.equal(classifyExecutionState(paused), "waiting");
});

test("no status and no stoppedAt classifies as running", () => {
  assert.equal(
    classifyExecutionState(execution({ status: undefined, finished: false, stoppedAt: null })),
    "running"
  );
});

test("finished flag without status counts as terminal", () => {
  assert.equal(classifyExecutionState(execution({ status: undefined, finished: true })), "terminal");
});

// --- error extraction ---------------------------------------------------------

test("collectNodeErrors picks only runs that errored", () => {
  const errors = collectNodeErrors({
    runData: {
      "HTTP Request": [
        { executionTime: 120, error: { name: "NodeApiError", message: "401 Unauthorized" } },
        { executionTime: 80 },
      ],
      Set: [{ executionTime: 5 }],
    },
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].node, "HTTP Request");
  assert.equal(errors[0].message, "401 Unauthorized");
});

test("collectNodeErrors on missing runData returns empty list", () => {
  assert.deepEqual(collectNodeErrors(undefined), []);
  assert.deepEqual(collectNodeErrors({}), []);
});

test("compactError truncates the stack to 5 lines", () => {
  const stack = Array.from({ length: 12 }, (_, i) => `at frame${i}`).join("\n");
  const compact = compactError({ message: "boom", stack });
  assert.equal(compact.stack.split("\n").length, 5);
  assert.equal(compactError(undefined), undefined);
});
