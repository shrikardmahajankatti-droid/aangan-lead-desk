import { Suspense } from "react";
import { connection } from "next/server";
import { setupStatus } from "@/lib/setup-status";

export default function SetupPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Setup status</h1>
      <p className="mt-1 text-sm text-stone-500">Which integrations are configured (never their values), and table sizes.</p>
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
    <div className="mt-6 space-y-6 text-sm">
      <ul className="space-y-1">
        {s.env.map((g) => (
          <li key={g.group} className="flex gap-2">
            <span>{g.ok ? "✅" : "⬜️"}</span>
            <span className="w-20 font-mono">{g.group}</span>
            {!g.ok && <span className="text-stone-500">{g.error}</span>}
          </li>
        ))}
      </ul>
      <p>DRY_RUN: <b>{String(s.dryRun)}</b></p>
      {s.db.error ? (
        <p className="text-red-600">{s.db.error}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {s.db.tables.map((t) => <li key={t.name} className="font-mono">{t.name}: {t.count}</li>)}
        </ul>
      )}
    </div>
  );
}
