import "server-only";
import { z } from "zod";

// Env is validated per integration, lazily, so the dashboard can boot (and
// dry-run) before every key exists. Each getter throws a clear message naming
// the missing variables. Defaults live here, not in .env.example.

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v.toLowerCase() !== "false"));
const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : Number(v)))
    .pipe(z.number().finite());
const req = z.string().min(1);

const schemas = {
  app: z.object({
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    // Anything other than the literal "false" keeps dry-run on.
    DRY_RUN: bool(true),
  }),
  db: z.object({
    DATABASE_URL: req,
  }),
  gemini: z.object({
    GEMINI_API_KEY: req,
    GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  }),
  vaani: z.object({
    VAANI_API_KEY: z.string().optional(),
    VAANI_WEBHOOK_SECRET: req,
    VAANI_PHONE_NUMBER: z.string().optional(),
  }),
  // Rates for the cost tile. Gemini rates are entered in ₹ per 1M tokens.
  costs: z.object({
    VAANI_COST_PER_MIN: num(0),
    GEMINI_INPUT_COST_PER_1M: num(0),
    GEMINI_OUTPUT_COST_PER_1M: num(0),
  }),
  google: z.object({
    GOOGLE_CLIENT_ID: req,
    GOOGLE_CLIENT_SECRET: req,
    GOOGLE_REFRESH_TOKEN: req,
    GOOGLE_CALENDAR_ID: req,
    CONSULT_DURATION_MIN: num(60),
    CONSULT_HOURS: z
      .string()
      .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
      .default("10:00-19:00"),
  }),
  resend: z.object({
    RESEND_API_KEY: req,
    EMAIL_FROM: z.string().default("onboarding@resend.dev"),
    DESIGNER_NAME: z.string().optional(),
    DESIGNER_EMAIL: z.string().email(),
    ESCALATION_EMAIL: z.string().email(),
  }),
  hubspot: z.object({
    HUBSPOT_ACCESS_TOKEN: req,
  }),
} as const;

type Schemas = typeof schemas;
export type EnvGroup = keyof Schemas;
const cache = new Map<EnvGroup, unknown>();

export function env<K extends EnvGroup>(group: K): z.infer<Schemas[K]> {
  if (cache.has(group)) return cache.get(group) as z.infer<Schemas[K]>;
  // Treat empty strings as unset so defaults apply.
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = schemas[group].safeParse(raw);
  if (!parsed.success) {
    const vars = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Missing or invalid env for ${group}: ${vars}`);
  }
  cache.set(group, parsed.data);
  return parsed.data as z.infer<Schemas[K]>;
}

/** DRY_RUN defaults to true: nothing is sent, pushed or booked unless explicitly "false". */
export const isDryRun = () => env("app").DRY_RUN;
