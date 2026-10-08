import { verifiedBody, parseToolRequest, toolResponse, VaaniAuthError } from "@/lib/vaani/adapter";
import type { ToolName, ToolRequest } from "@/lib/vaani/types";

/** Shared wrapper for mid-call tool routes: verify signature → parse → handle → respond. */
export function toolRoute(tool: ToolName, handle: (r: ToolRequest) => Promise<Record<string, unknown>>) {
  return async function POST(req: Request) {
    let raw: string;
    try {
      raw = await verifiedBody(req);
    } catch (e) {
      const status = e instanceof VaaniAuthError ? 401 : 500;
      return Response.json({ error: status === 401 ? "unauthorized" : "server misconfigured" }, { status });
    }
    let r: ToolRequest;
    try {
      r = parseToolRequest(tool, raw);
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    return toolResponse(await handle(r));
  };
}
