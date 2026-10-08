import { Suspense } from "react";
import { connection } from "next/server";
import { setupStatus } from "@/lib/setup-status";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Aangan Lead Desk</h1>
      <p className="mt-1 text-sm text-zinc-500">Setup status (step 1). The dashboard replaces this page in step 3.</p>
      <Suspense fallback={<p className="mt-6 text-sm">Checking…</p>}>
        <Status />
      </Suspense>
    </main>
  );
}

async function Status() {
  await connection();
  const s = await setupStatus();
  return (
    <div className="mt-6 space-y-6">
      <section>
        <h2 className="mb-2 font-medium">Environment</h2>
        <ul className="space-y-1 text-sm">
          {s.env.map((g) => (
            <li key={g.group} className="flex gap-2">
              <span>{g.ok ? "✅" : "⬜️"}</span>
              <span className="font-mono">{g.group}</span>
              {!g.ok && <span className="text-zinc-500">{g.error}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          DRY_RUN: <b>{String(s.dryRun)}</b>
        </p>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Supabase tables</h2>
        {s.db.error ? (
          <p className="text-sm text-red-600">{s.db.error}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
            {s.db.tables.map((t) => (
              <li key={t.name} className="font-mono">
                {t.name}: {t.count}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
