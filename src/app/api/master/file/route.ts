import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb } from "@/lib/commerce/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/master/file?kind=preview|mockup&id=…&idx=… — Phase 2/3.
 * Serves watermarked previews & generated mockups for review/owner views.
 * Access: admin, owning artist, or the master's linked approved pattern page
 * (previews are watermarked, so public pattern pages may reference them).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") ?? "preview";
  const idx = Number(url.searchParams.get("idx") ?? 0);

  const db = await readDb();
  const master = db.masters.find((m) => m.id === id);
  if (!master) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore({ status: 404 }));

  let target: string | undefined;
  if (kind === "preview") target = master.previewPath;
  else if (kind === "mockup") target = master.mockupPaths?.[idx];
  else target = master.previewPath;
  if (!target) return NextResponse.json({ ok: false, error: "no_asset" }, withNoStore({ status: 404 }));

  const abs = path.join(process.cwd(), target);
  const root = path.join(process.cwd(), "data", "masters");
  if (!path.resolve(abs).startsWith(path.resolve(root) + path.sep)) {
    return NextResponse.json({ ok: false, error: "bad_path" }, withNoStore({ status: 500 }));
  }

  let data: Buffer;
  try {
    data = await fs.readFile(abs);
  } catch {
    return NextResponse.json({ ok: false, error: "file_missing" }, withNoStore({ status: 404 }));
  }

  /* raw masters require an authenticated owner/admin; watermarked
     previews/mockups are safe for anyone linked from an approved pattern */
  if (kind === "raw") {
    const session = await getSession();
    const isAdmin = session?.role === "admin";
    const isOwner = Boolean(session && master.artistId && session.artistId === master.artistId);
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ ok: false, error: "forbidden" }, withNoStore({ status: 403 }));
    }
  }

  const mime = target.endsWith(".png") ? "image/png" : target.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(data.length),
      "cache-control": kind === "raw" ? "private, no-store" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
