import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb, withDb } from "@/lib/commerce/store";
import { certificateNo, signValue } from "@/lib/commerce/signed";
import { renderLicensePdf } from "@/lib/commerce/license-pdf";
import { LICENSE_FA } from "@/lib/commerce/fulfil";

export const dynamic = "force-dynamic";

/**
 * GET /api/license?id=<licenseId>          → Persian licence certificate PDF (Phase 2/3)
 * GET /api/license?verify=<certificateNo>   → public JSON authenticity check
 *
 * Access: the logged-in holder (email match) or an admin. The verify endpoint
 * needs no session — it only exposes non-sensitive attestation fields.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  /* ── public verification (no auth) ─────────────────────────────── */
  const verifyCode = url.searchParams.get("verify");
  if (verifyCode) {
    const db = await readDb();
    const lic = db.licenses.find((l) => l.certificateNo.toUpperCase() === verifyCode.toUpperCase());
    if (!lic) {
      return NextResponse.json({ ok: false, valid: false, error: "not_found" }, withNoStore());
    }
    return NextResponse.json(
      {
        ok: true,
        valid: true,
        certificateNo: lic.certificateNo,
        type: lic.type,
        holderName: lic.holderName,
        issuedAt: lic.issuedAt,
        signature: signValue(["verify", lic.id]),
      },
      withNoStore(),
    );
  }

  /* ── PDF issue (holder or admin) ───────────────────────────────── */
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" }, withNoStore({ status: 400 }));

  const session = await getSession();
  const db = await readDb();
  const lic = db.licenses.find((l) => l.id === id);
  if (!lic) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore({ status: 404 }));

  const isHolder = session && session.email.toLowerCase() === lic.holderEmail.toLowerCase();
  const isAdmin = session?.role === "admin";
  if (!isHolder && !isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, withNoStore({ status: 403 }));
  }

  /* re-issue certificateNo deterministically if missing (legacy rows) */
  if (!lic.certificateNo) {
    lic.certificateNo = certificateNo(lic.id);
    await withDb((d) => {
      const row = d.licenses.find((l) => l.id === lic.id);
      if (row) row.certificateNo = lic.certificateNo;
    });
  }

  const master = db.masters.find((m) => m.id === lic.masterId);
  const purchase = db.purchases.find((p) => p.id === lic.purchaseId);
  const line = purchase?.lines.find((l) => l.kind === "pattern" && l.id === lic.patternId)
    ?? purchase?.lines.find((l) => l.kind === "pattern");

  let artistName = "Rosie Atelier";
  if (lic.patternId) {
    const { getContent } = await import("@/lib/data/store");
    const site = await getContent();
    const pattern = site.patterns.find((p) => p.id === lic.patternId);
    if (pattern?.artistId) {
      const artist = site.artists.find((a) => a.id === pattern.artistId);
      if (artist) artistName = artist.name.fa || artist.name.en;
    }
  }

  const pdf = await renderLicensePdf({
    licenseId: lic.id,
    certificateNo: lic.certificateNo,
    holderName: lic.holderName,
    holderEmail: lic.holderEmail,
    workTitle: line?.title ?? master?.title ?? "Rosie Atelier work",
    artistName,
    licenseTypeFa: LICENSE_FA[lic.type] ?? lic.type,
    issuedAt: lic.issuedAt,
    purchaseId: lic.purchaseId,
  });

  const fname = encodeURIComponent(`license-${lic.certificateNo}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.length),
      "content-disposition": `attachment; filename*=UTF-8''${fname}`,
      "cache-control": "private, no-store",
    },
  });
}
