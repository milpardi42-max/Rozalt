import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb } from "@/lib/commerce/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/master/mine — Phase 1: list the calling artist's (or admin's) masters.
 * Query: ?status=pending|approved|rejected (optional filter)
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.role !== "artist" && session.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const db = await readDb();
  const statusFilter = new URL(req.url).searchParams.get("status");

  let masters = db.masters;
  if (session.role === "artist") {
    masters = masters.filter((m) => m.artistId && m.artistId === session.artistId);
  }
  if (statusFilter) {
    masters = masters.filter((m) => m.status === statusFilter);
  }

  /* attach licence/download stats relevant to the owner */
  const licensesByMaster = new Map<string, number>();
  for (const l of db.licenses) {
    licensesByMaster.set(l.masterId, (licensesByMaster.get(l.masterId) ?? 0) + 1);
  }

  return NextResponse.json(
    {
      ok: true,
      masters: masters.map((m) => ({
        ...m,
        licenseCount: licensesByMaster.get(m.id) ?? 0,
        // never expose absolute storage paths to the client
        storagePath: undefined,
        previewPath: m.previewPath ? `/api/master/file?kind=preview&id=${m.id}` : undefined,
        mockupPaths: m.mockupPaths?.map((_, i) => `/api/master/file?kind=mockup&idx=${i}&id=${m.id}`),
      })),
    },
    withNoStore(),
  );
}
