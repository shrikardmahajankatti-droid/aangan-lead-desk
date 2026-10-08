// Applies db/migrations/*.sql in order, once each, over the direct (unpooled) connection.
// Plain Postgres over TCP (node-postgres), as Neon recommends for migrations.
// Usage: npm run db:migrate
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env.local");
  process.exit(1);
}

const dir = path.join(process.cwd(), "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let client = new pg.Client({ connectionString: url });
try {
  await client.connect();
} catch (e) {
  // Direct host unreachable (e.g. DNS): the pooler also runs DDL inside a transaction fine.
  const pooled = process.env.DATABASE_URL;
  if (!pooled || pooled === url) throw e;
  console.warn(`Direct connection failed (${(e as Error).message}); using the pooled URL.`);
  client = new pg.Client({ connectionString: pooled });
  await client.connect();
}

try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`✓ ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
} finally {
  await client.end();
}
