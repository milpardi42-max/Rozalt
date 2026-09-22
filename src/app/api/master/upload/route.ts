import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { clientIp, tooManyAttempts, recordAttempt, retryAfterSeconds } from "@/lib/rate-limit";
import { withDb, newId, nowIso } from "@/lib/commerce/store";
import { scanBuffer } from "@/lib/commerce/virus";
import { buildWatermarkedPreview, ensureDir, isImageExt, privateMastersDir } from "@/lib/commerce/watermark";
import { analyzeSeamless } from "@/lib/commerce/seamless";
import type { MasterFile } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

/** Design-master formats accepted (Phase 1 + growth formats) */
const ALLOWED_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  pdf: "application/pdf", svg: "image/svg+xml",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
};

/**
 * POST /api/master/upload — Phase 1: private master file upload (artist/admin).
 *
 * Files land under data/masters/ (NEVER /public). Single-shot limit 64 MB;
 * larger files must use /api/master/upload/multipart (Phase 4 presigned flow).
 * Pipeline: magic/extension validation → virus scan → watermark preview (images)
 * → seamless analysis (images) → record with status=pending awaiting admin review.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.role !== "artist" && session.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const rlKey = `upload:${clientIp(req)}`;
  if (tooManyAttempts(rlKey)) {
    const res = NextResponse.json({ ok: false, error: "too_many_attempts" }, withNoStore({ status: 429 }));
    const retry = retryAfterSeconds(rlKey);
    if (retry > 0) res.headers.set("Retry-After", String(retry));
    return res;
  }
  recordAttempt(rlKey);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form" }, withNoStore({ status: 400 }));
  }

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const patternId = String(form.get("patternId") ?? "").trim() || undefined;

  if (!(file instanceof File) || !title) {
    return NextResponse.json({ ok: false, error: "missing_file_or_title" }, withNoStore({ status: 400 }));
  }

  const MAX_SINGLE = 64 * 1024 * 1024; // 64 MB single-shot; beyond → multipart
  if (file.size > MAX_SINGLE) {
    return NextResponse.json(
      { ok: false, error: "use_multipart", maxSingleBytes: MAX_SINGLE },
      withNoStore({ status: 413 }),
    );
  }

  const originalName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "master";
  const ext = (originalName.includes(".") ? originalName.split(".").pop() ?? "" : "").toLowerCase();
  const mime = ALLOWED_EXT[ext];
  if (!mime) {
    return NextResponse.json(
      { ok: false, error: "unsupported_type", allowed: Object.keys(ALLOWED_EXT) },
      withNoStore({ status: 415 }),
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  /* SVG sanitisation — reject script-bearing SVG outright */
  if (ext === "svg" && /<script|onload|onerror|javascript:/i.test(buf.toString("utf8"))) {
    return NextResponse.json({ ok: false, error: "malicious_svg" }, withNoStore({ status: 415 }));
  }

  const scan = await scanBuffer(buf, originalName);
  if (scan.status === "infected") {
    return NextResponse.json(
      { ok: false, error: "virus_detected", detail: scan.detail, engine: scan.engine },
      withNoStore({ status: 415 }),
    );
  }

  const id = newId("mst");
  const dir = path.join(privateMastersDir(), id);
  await ensureDir(dir);
  const storagePath = path.join(dir, `master.${ext}`);
  await fs.writeFile(storagePath, buf);

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const previewPath = (await buildWatermarkedPreview(storagePath, ext)) ?? undefined;

  let analysis: MasterFile["analysis"];
  if (isImageExt(ext)) {
    const report = await analyzeSeamless(storagePath, ext);
    if (report) analysis = report;
  }

  const record: MasterFile = {
    id,
    artistId: session.role === "artist" ? (session.artistId ?? null) : null,
    uploadedBy: session.id,
    title,
    ...(description ? { description } : {}),
    originalName,
    ext,
    mime,
    sizeBytes: buf.length,
    sha256,
    // store path relative to cwd for portability
    storagePath: path.relative(process.cwd(), storagePath),
    ...(previewPath ? { previewPath: path.relative(process.cwd(), previewPath) } : {}),
    ...(patternId ? { patternId } : {}),
    status: "pending",
    virusScan: scan,
    ...(analysis ? { analysis } : {}),
    downloadCount: 0,
    createdAt: nowIso(),
  };

  await withDb((db) => {
    db.masters.unshift(record);
  });

  return NextResponse.json({ ok: true, master: record }, withNoStore());
}
