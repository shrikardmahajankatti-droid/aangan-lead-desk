import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";

// Calendar invites are created mid-call, before the call record exists; they link here.
export default function VaaniCallRedirect({ params }: PageProps<"/calls/vaani/[vaaniId]">) {
  return (
    <Suspense fallback={null}>
      <Go params={params} />
    </Suspense>
  );
}

async function Go({ params }: { params: PageProps<"/calls/vaani/[vaaniId]">["params"] }): Promise<null> {
  const { vaaniId } = await params;
  const [row] = (await sql()`
    select id from calls where external_id = ${decodeURIComponent(vaaniId)} and source in ('vaani', 'simulated')
    order by created_at desc limit 1`) as { id: string }[];
  if (!row) notFound();
  redirect(`/calls/${row.id}`);
  return null;
}
