import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// The /context markdown files are the rulebook. They're read from disk at
// runtime (bundled via outputFileTracingIncludes in next.config.ts).
const FILES = ["qualification_logic.md", "qualified.md", "services.md", "pricing.md"] as const;
export type ContextFile = (typeof FILES)[number];

let cache: Record<ContextFile, string> | null = null;

export function contextFiles(): Record<ContextFile, string> {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "context");
  cache = Object.fromEntries(
    FILES.map((f) => [f, readFileSync(path.join(dir, f), "utf8")]),
  ) as Record<ContextFile, string>;
  return cache;
}

/** All context files concatenated with headers, for the Gemini system prompt. */
export function contextBundle(): string {
  return Object.entries(contextFiles())
    .map(([name, body]) => `===== ${name} =====\n${body.trim()}`)
    .join("\n\n");
}
