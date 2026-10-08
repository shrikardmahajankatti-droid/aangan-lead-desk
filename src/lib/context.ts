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

/**
 * All context files concatenated with headers, for the Gemini system prompt.
 * stripCalibration removes the "Calibration set" table (expected answers for
 * T01–T20) so seed results measure the rules, not a lookup of the answer key.
 */
export function contextBundle(opts: { stripCalibration?: boolean } = {}): string {
  return Object.entries(contextFiles())
    .map(([name, body]) => {
      let text = body.trim();
      if (opts.stripCalibration && name === "qualification_logic.md") {
        text = text.replace(/\n## Calibration set[\s\S]*?(?=\n## |\s*$)/, "\n");
      }
      return `===== ${name} =====\n${text}`;
    })
    .join("\n\n");
}
