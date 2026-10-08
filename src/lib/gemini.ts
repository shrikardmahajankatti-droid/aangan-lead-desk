import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { env } from "./env";

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env("gemini").GEMINI_API_KEY });
  return client;
}

export type Usage = { tokens_in: number; tokens_out: number; cost_inr: number };
export type JsonResult<T> = { data: T; usage: Usage; model: string; attempts: number };

export function costInr(tokensIn: number, tokensOut: number): number {
  const { GEMINI_INPUT_COST_PER_1M, GEMINI_OUTPUT_COST_PER_1M } = env("costs");
  return (tokensIn * GEMINI_INPUT_COST_PER_1M + tokensOut * GEMINI_OUTPUT_COST_PER_1M) / 1_000_000;
}

/** zod → JSON Schema for responseJsonSchema (single source of truth for the shape). */
export function toResponseSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const FALLBACK_MODEL = "gemini-3.7-flash";

/**
 * As generateJsonOnce, but if the primary model stays unavailable (transient
 * errors exhausted) it tries FALLBACK_MODEL once. The model that answered is returned.
 */
export async function generateJson<S extends z.ZodType>(
  opts: Parameters<typeof generateJsonOnce<S>>[0] & { fallback?: boolean },
): Promise<JsonResult<z.infer<S>>> {
  const primary = env("gemini").GEMINI_MODEL;
  try {
    return await generateJsonOnce({ ...opts, model: primary });
  } catch (e) {
    if (!(e instanceof GeminiError) || !e.transient || opts.fallback === false || primary === FALLBACK_MODEL) throw e;
    const res = await generateJsonOnce({ ...opts, model: FALLBACK_MODEL });
    // Primary's failed attempts were billed too.
    res.usage.tokens_in += e.usage.tokens_in;
    res.usage.tokens_out += e.usage.tokens_out;
    res.usage.cost_inr = costInr(res.usage.tokens_in, res.usage.tokens_out);
    return res;
  }
}

/**
 * Calls Gemini in JSON mode against a zod schema.
 * - Transient API errors (429/5xx, timeouts) are retried with backoff.
 * - A response that fails zod validation is retried once, then throws.
 * Token usage is summed across all attempts (they're all billed).
 */
async function generateJsonOnce<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
  thinking?: ThinkingLevel;
  transientRetries?: number;
  /** Longest single backoff to accept; live mid-call checks pass a small value. */
  maxWaitMs?: number;
  /** Retries after a response fails validation (default 1). */
  validationRetries?: number;
}): Promise<JsonResult<z.infer<S>>> {
  const model = opts.model ?? env("gemini").GEMINI_MODEL;
  const responseJsonSchema = toResponseSchema(opts.schema);
  const usage = { tokens_in: 0, tokens_out: 0 };
  let attempts = 0;
  let validationFailures = 0;
  let transientFailures = 0;
  let lastError: unknown;

  while (validationFailures <= (opts.validationRetries ?? 1)) {
    attempts++;
    try {
      const res = await ai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema,
          ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}),
          abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
        },
      });
      const u = res.usageMetadata;
      usage.tokens_in += u?.promptTokenCount ?? 0;
      usage.tokens_out += (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);

      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text ?? "");
      } catch {
        throw new ValidationError("Response was not valid JSON");
      }
      const result = opts.schema.safeParse(parsed);
      if (!result.success) throw new ValidationError(z.prettifyError(result.error));
      return {
        data: result.data,
        usage: { ...usage, cost_inr: costInr(usage.tokens_in, usage.tokens_out) },
        model,
        attempts,
      };
    } catch (e) {
      lastError = e;
      if (e instanceof ValidationError) {
        validationFailures++;
        continue;
      }
      const status = (e as { status?: number }).status;
      const isTimeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
      const transient = isTimeout || Boolean(status && TRANSIENT.has(status));
      if (transient && transientFailures < (opts.transientRetries ?? 5)) {
        transientFailures++;
        // 429: wait as long as the API says (free tier is 5 requests/min/model), within maxWaitMs.
        const hinted = status === 429 ? retryDelayMs((e as Error).message) : null;
        const wait = hinted ?? 1000 * 2 ** (transientFailures - 1) + Math.random() * 500;
        if (wait > (opts.maxWaitMs ?? 70_000)) throw new GeminiError(`${model}: ${(e as Error).message}`, usage, true);
        await sleep(wait);
        continue;
      }
      throw new GeminiError(`${model}: ${(e as Error).message}`, usage, transient);
    }
  }
  throw new GeminiError(`${model}: invalid output after retry: ${(lastError as Error).message}`, usage);
}

/** Reads google.rpc.RetryInfo ("retryDelay": "59s") from an API error message. */
function retryDelayMs(message: string): number | null {
  const m = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : null;
}

export class ValidationError extends Error {}
export class GeminiError extends Error {
  constructor(
    message: string,
    public usage: { tokens_in: number; tokens_out: number },
    public transient = false,
  ) {
    super(message);
  }
}
