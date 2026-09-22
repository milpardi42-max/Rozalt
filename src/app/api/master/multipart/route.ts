import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { signValue, verifyValue } from "@/lib/commerce/signed";
import { withDb, readDb, newId, nowIso } from "@/lib/commerce/store";
import { newUploadId } from "@/lib/commerce/virus";
import { scanBuffer } from "@/lib/commerce/virus";
import { buildWatermarkedPreview, ensureDir, isImageExt, privateMastersDir } from "@/lib/commerce/watermark";
import { analyzeSeamless } from "@/lib/commerce/seamless";
import type { MasterFile, MultipartUpload } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

const PART_SIZE = 8 * 1024 * 1024; // 8 MB parts
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2 GiB hard cap
const EXTS: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  pdf: "application/pdf", psd: "image/vnd.adobe.photoshop", ai: "application/postscript",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
};

function partSig(uploadId: string, partNumber: number, exp: number): string {
  return signValue(["part", uploadId, String(partNumber), String(exp)]);
}

/**
 * Presigned multipart upload for files > 64 MB (فاز ۴).
 *
 *   POST ?action=init     {fileName, sizeBytes, title, …} → {uploadId, partUrls[]}
 *   POST ?action=part     raw body + headers X-Part-Sign … → append chunk
 *   POST ?action=complete {uploadId, sha256?}               → assemble + scan + record
 *
 * Each part URL is HMAC-signed with its own expiry (presigned semantics,
 * same trust model as S3 multipart presigns — but self-hosted).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.role !== "artist" && session.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "init";

  /* ── init ───────────────────────────────────────────────────────── */
  if (action === "init") {
    const body = (await req.json().catch(() => null)) as {
      fileName?: string;
      sizeBytes?: number;
      title?: string;
      description?: string;
      patternId?: string;
    } | null;
    if (!body?.fileName || !body.title || !body.sizeBytes || body.sizeBytes <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, withNoStore({ status: 400 }));
    }
    if (body.sizeBytes > MAX_TOTAL) {
      return NextResponse.json({ ok: false, error: "too_large", maxBytes: MAX_TOTAL }, withNoStore({ status: 413 }));
    }

    const ext = (body.fileName.split(".").pop() ?? "").toLowerCase();
    if (!EXTS[ext]) {
      return NextResponse.json({ ok: false, error: "unsupported_type", allowed: Object.keys(EXTS) }, withNoStore({ status: 415 }));
    }

    const uploadId = newUploadId();
    const partCount = Math.ceil(body.sizeBytes / PART_SIZE);
    if (partCount > 1000) {
      return NextResponse.json({ ok: false, error: "too_many_parts" }, withNoStore({ status: 413 }));
    }

    const tmpDir = path.join(privateMastersDir(), ".uploads", uploadId);
    await ensureDir(tmpDir);

    const record: MultipartUpload = {
      id: uploadId,
      uploadedBy: session.id,
      artistId: session.role === "artist" ? (session.artistId ?? null) : null,
      fileName: body.fileName,
      title: body.title,
      ...(body.description ? { description: body.description } : {}),
      ...(body.patternId ? { patternId: body.patternId } : {}),
      sizeBytes: body.sizeBytes,
      partSize: PART_SIZE,
      partCount,
      receivedParts: [],
      tmpDir: path.relative(process.cwd(), tmpDir),
      createdAt: nowIso(),
    };
    await withDb((db) => {
      db.uploads.push(record);
    });

    const exp = Math.floor(Date.now() / 1000) + 6 * 3600; // 6h to finish
    const partUrls = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      url: `/api/master/multipart?action=part&uploadId=${uploadId}&partNumber=${i + 1}&exp=${exp}&sig=${encodeURIComponent(partSig(uploadId, i + 1, exp))}`,
    }));

    return NextResponse.json({ ok: true, uploadId, partSize: PART_SIZE, partCount, partUrls, exp }, withNoStore());
  }

  /* ── part ───────────────────────────────────────────────────────── */
  if (action === "part") {
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const partNumber = Number(url.searchParams.get("partNumber") ?? 0);
    const exp = Number(url.searchParams.get("exp") ?? 0);
    const sig = url.searchParams.get("sig") ?? "";

    if (!uploadId || !partNumber || !verifyValue(["part", uploadId, String(partNumber), String(exp)], sig)) {
      return NextResponse.json({ ok: false, error: "bad_signature" }, withNoStore({ status: 403 }));
    }
    if (exp * 1000 < Date.now()) {
      return NextResponse.json({ ok: false, error: "part_expired" }, withNoStore({ status: 403 }));
    }

    const db = await readDb();
    const upload = db.uploads.find((u) => u.id === uploadId);
    if (!upload) return NextResponse.json({ ok: false, error: "unknown_upload" }, withNoStore({ status: 404 }));
    if (session.role !== "admin" && session.id !== upload.uploadedBy) {
      return NextResponse.json({ ok: false, error: "forbidden" }, withNoStore({ status: 403 }));
    }
    if (partNumber < 1 || partNumber > upload.partCount) {
      return NextResponse.json({ ok: false, error: "part_out_of_range" }, withNoStore({ status: 400 }));
    }

    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > upload.partSize + 1024) {
      return NextResponse.json({ ok: false, error: "part_too_large" }, withNoStore({ status: 413 }));
    }

    const abs = path.join(process.cwd(), upload.tmpDir, `part-${String(partNumber).padStart(4, "0")}`);
    await fs.writeFile(abs, buf);

    await withDb((d) => {
      const u = d.uploads.find((x) => x.id === uploadId);
      if (u && !u.receivedParts.includes(partNumber)) u.receivedParts.push(partNumber);
    });

    return NextResponse.json({ ok: true, partNumber }, withNoStore());
  }

  /* ── complete ───────────────────────────────────────────────────── */
  if (action === "complete") {
    const body = (await req.json().catch(() => null)) as { uploadId?: string } | null;
    if (!body?.uploadId) {
      return NextResponse.json({ ok: false, error: "missing_upload_id" }, withNoStore({ status: 400 }));
    }

    const db = await readDb();
    const upload = db.uploads.find((u) => u.id === body.uploadId);
    if (!upload) return NextResponse.json({ ok: false, error: "unknown_upload" }, withNoStore({ status: 404 }));
    if (session.role !== "admin" && session.id !== upload.uploadedBy) {
      return NextResponse.json({ ok: false, error: "forbidden" }, withNoStore({ status: 403 }));
    }
    if (upload.receivedParts.length !== upload.partCount) {
      return NextResponse.json(
        { ok: false, error: "missing_parts", got: upload.receivedParts.length, want: upload.partCount },
        withNoStore({ status: 400 }),
      );
    }

    /* assemble */
    const tmpAbs = path.join(process.cwd(), upload.tmpDir);
    const ext = (upload.fileName.split(".").pop() ?? "").toLowerCase();
    const id = newId("mst");
    const dir = path.join(privateMastersDir(), id);
    await ensureDir(dir);
    const finalPath = path.join(dir, `master.${ext}`);
    const out = await fs.open(finalPath, "w");
    try {
      for (let i = 1; i <= upload.partCount; i++) {
        const partPath = path.join(tmpAbs, `part-${String(i).padStart(4, "0")}`);
        const buf = await fs.readFile(partPath);
        await out.write(buf);
      }
    } finally {
      await out.close();
    }
    await fs.rm(tmpAbs, { recursive: true, force: true });

    const buf = await fs.readFile(finalPath);
    if (buf.length !== upload.sizeBytes) {
      await fs.rm(dir, { recursive: true, force: true });
      return NextResponse.json(
        { ok: false, error: "size_mismatch", got: buf.length, want: upload.sizeBytes },
        withNoStore({ status: 400 }),
      );
    }

    const scan = await scanBuffer(buf, upload.fileName);
    if (scan.status === "infected") {
      await fs.rm(dir, { recursive: true, force: true });
      await withDb((d) => { d.uploads = d.uploads.filter((u) => u.id !== upload.id); });
      return NextResponse.json(
        { ok: false, error: "virus_detected", detail: scan.detail, engine: scan.engine },
        withNoStore({ status: 415 }),
      );
    }

    const previewPath = (await buildWatermarkedPreview(finalPath, ext)) ?? undefined;
    let analysis: MasterFile["analysis"];
    if (isImageExt(ext)) {
      const report = await analyzeSeamless(finalPath, ext);
      if (report) analysis = report;
    }

    const record: MasterFile = {
      id,
      artistId: upload.artistId,
      uploadedBy: upload.uploadedBy,
      title: upload.title,
      ...(upload.description ? { description: upload.description } : {}),
      originalName: upload.fileName,
      ext,
      mime: EXTS[ext] ?? "application/octet-stream",
      sizeBytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      storagePath: path.relative(process.cwd(), finalPath),
      ...(previewPath ? { previewPath: path.relative(process.cwd(), previewPath) } : {}),
      ...(upload.patternId ? { patternId: upload.patternId } : {}),
      status: "pending",
      virusScan: scan,
      ...(analysis ? { analysis } : {}),
      downloadCount: 0,
      createdAt: nowIso(),
    };

    await withDb((d) => {
      d.masters.unshift(record);
      d.uploads = d.uploads.filter((u) => u.id !== upload.id);
    });

    return NextResponse.json({ ok: true, master: record }, withNoStore());
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, withNoStore({ status: 400 }));
}
