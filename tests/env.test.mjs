import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDotEnv, readPackageVersion } from "../dist/env.js";

test("parses simple KEY=VALUE pairs", () => {
  const env = parseDotEnv("N8N_API_URL=https://n8n.example.com\nN8N_API_KEY=abc123\n");
  assert.equal(env.N8N_API_URL, "https://n8n.example.com");
  assert.equal(env.N8N_API_KEY, "abc123");
});

test("strips inline comments from unquoted values", () => {
  const env = parseDotEnv("N8N_API_KEY=abc123 # production key\n");
  assert.equal(env.N8N_API_KEY, "abc123");
});

test("quoted values keep # and surrounding content", () => {
  const env = parseDotEnv('PASSWORD="p#ss w0rd"\n');
  assert.equal(env.PASSWORD, "p#ss w0rd");
});

test("accepts lowercase and mixed-case keys", () => {
  const env = parseDotEnv("my_key=value\nMixed_Key2=other\n");
  assert.equal(env.my_key, "value");
  assert.equal(env.Mixed_Key2, "other");
});

test("skips comment lines, blank lines and empty values", () => {
  const env = parseDotEnv("# comment\n\nEMPTY=\nREAL=yes\n");
  assert.equal(env.EMPTY, undefined);
  assert.equal(env.REAL, "yes");
});

test("readPackageVersion returns the version of this package", () => {
  const version = readPackageVersion(new URL("../package.json", import.meta.url).pathname);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("readPackageVersion falls back on missing file", () => {
  assert.equal(readPackageVersion("/nonexistent/package.json"), "0.0.0");
});
