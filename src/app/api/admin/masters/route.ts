import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb, withDb, nowIso } from "@/lib/commerce/store";
import { generateMockups } from "@/lib/commerce/mockup";
import type { MasterStatus } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

/**
 * GET    /api/admin/masters        → full review queue (admin)
 * PATCH  /api/admin/masters        → approve / reject + regenerate analysis
 * POST   /api/admin/masters/mockup → (re)generate mockups for one master (Phase 3)
 * DELETE /api/admin/masters?id=    → remove master record + private file
 */
async function requireAdmin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }
  const db = await readDb();
  return NextResponse.json({ ok: true, masters: db.masters }, withNoStore());
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    action?: "approve" | "reject";
    note?: string;
    patternId?: string;
  } | null;
  if (!body?.id || !body.action) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, withNoStore({ status: 400 }));
  }

  const status: MasterStatus = body.action === "approve" ? "approved" : "rejected";
  let updated = false;
  await withDb((db) => {
    const m = db.masters.find((x) => x.id === body.id);
    if (!m) return;
    m.status = status;
    m.reviewedAt = nowIso();
    if (body.note !== undefined) m.reviewNote = body.note;
    if (body.patternId !== undefined) m.patternId = body.patternId || undefined;
    updated = true;
  });

  if (!updated) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore({ status: 404 }));
  const db = await readDb();
  return NextResponse.json({ ok: true, master: db.masters.find((m) => m.id === body.id) }, withNoStore());
}

/** Phase 3 — auto mockup generation, triggered from the review queue. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "missing_id" }, withNoStore({ status: 400 }));

  const db = await readDb();
  const master = db.masters.find((m) => m.id === body.id);
  if (!master) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore({ status: 404 }));

  const abs = path.join(process.cwd(), master.storagePath);
  const buffers = await generateMockups(abs, master.ext);
  if (!buffers.length) {
    return NextResponse.json({ ok: false, error: "not_raster" }, withNoStore({ status: 415 }));
  }

  const dir = path.dirname(abs);
  const paths: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(dir, `mockup-${i + 1}.png`);
    await fs.writeFile(p, buffers[i]);
    paths.push(path.relative(process.cwd(), p));
  }

  await withDb((d) => {
    const m = d.masters.find((x) => x.id === master.id);
    if (m) m.mockupPaths = paths;
  });

  return NextResponse.json({ ok: true, mockups: paths }, withNoStore());
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" }, withNoStore({ status: 400 }));

  const removed: { storagePath: string } = { storagePath: "" };
  await withDb((db) => {
    const idx = db.masters.findIndex((m) => m.id === id);
    if (idx >= 0) {
      removed.storagePath = db.masters[idx].storagePath;
      db.masters.splice(idx, 1);
    }
  });
  if (!removed.storagePath) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore({ status: 404 }));

  /* best-effort private directory cleanup */
  try {
    const dir = path.dirname(path.join(process.cwd(), removed.storagePath));
    const root = path.join(process.cwd(), "data", "masters");
    if (dir.startsWith(root)) await fs.rm(dir, { recursive: true, force: true });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true }, withNoStore());
}
