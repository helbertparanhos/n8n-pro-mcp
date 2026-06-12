import { readFileSync } from "node:fs";

/**
 * Parses .env content into key/value pairs. Quoted values keep everything
 * inside the quotes; unquoted values lose inline `#` comments. Empty values
 * are skipped.
 */
export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const quoted = rawValue.match(/^(["'])(.*)\1/);
    const value = quoted ? quoted[2] : rawValue.replace(/\s+#.*$/, "");
    if (value) out[key] = value;
  }
  return out;
}

/** Loads a .env file into process.env without overriding variables already set by the MCP client config. */
export function loadDotEnv(envPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseDotEnv(raw))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function readPackageVersion(pkgPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
