import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { verifyDownload } from "@/lib/commerce/signed";
import { withDb, readDb, nowIso } from "@/lib/commerce/store";
import { clientIp, tooManyAttempts, recordAttempt, retryAfterSeconds } from "@/lib/rate-limit";
import { withNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/download?t=<signed token> — Phase 1: secure signed download.
 *
 * Token = HMAC(payload{license, master, exp}) — unforgeable, time-boxed.
 * Streams the private master from data/masters/ with no-store + attachment
 * headers. Every hit increments the audit counter on the master record.
 */
export async function GET(req: Request) {
  const rlKey = `download:${clientIp(req)}`;
  if (tooManyAttempts(rlKey)) {
    const res = NextResponse.json({ ok: false, error: "too_many_attempts" }, withNoStore({ status: 429 }));
    const retry = retryAfterSeconds(rlKey);
    if (retry > 0) res.headers.set("Retry-After", String(retry));
    return res;
  }
  recordAttempt(rlKey);

  const token = new URL(req.url).searchParams.get("t") ?? "";
  const claims = verifyDownload(token);
  if (!claims) {
    return NextResponse.json({ ok: false, error: "invalid_or_expired_token" }, withNoStore({ status: 403 }));
  }

  const db = await readDb();
  const license = db.licenses.find((l) => l.id === claims.l);
  const master = db.masters.find((m) => m.id === claims.m);
  if (!license || !master || license.masterId !== master.id) {
    return NextResponse.json({ ok: false, error: "license_mismatch" }, withNoStore({ status: 403 }));
  }
  if (master.soldExclusive && license.type !== "exclusive") {
    return NextResponse.json({ ok: false, error: "sold_exclusive" }, withNoStore({ status: 403 }));
  }

  const abs = path.join(process.cwd(), master.storagePath);
  /* path traversal guard — resolved path must live under data/masters */
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

  await withDb((d) => {
    const m = d.masters.find((x) => x.id === master.id);
    if (m) m.downloadCount += 1;
    void nowIso;
  });

  const filename = encodeURIComponent(master.originalName);
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": master.mime,
      "content-length": String(data.length),
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}
