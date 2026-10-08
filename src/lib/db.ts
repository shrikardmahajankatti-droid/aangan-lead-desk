import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

let client: NeonQueryFunction<false, false> | null = null;

/**
 * Neon HTTP query function over the pooled DATABASE_URL. Server only.
 * Usage: await sql()`select * from calls where id = ${id}`
 */
export function sql(): NeonQueryFunction<false, false> {
  if (!client) client = neon(env("db").DATABASE_URL);
  return client;
}
