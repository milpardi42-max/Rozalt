import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb } from "@/lib/commerce/store";
import { signDownload } from "@/lib/commerce/signed";
import { planById } from "@/lib/commerce/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchases — Phase 1/2: the caller's purchase history with
 * freshly-issued signed download URLs (1 h) and certificate links.
 * Admins see everything.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const db = await readDb();
  const isAdmin = session.role === "admin";
  const email = session.email.toLowerCase();

  const purchases = db.purchases
    .filter((p) => isAdmin || p.userId === session.id || p.email === email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const licensesByPurchase = new Map<string, typeof db.licenses>();
  for (const l of db.licenses) {
    const arr = licensesByPurchase.get(l.purchaseId) ?? [];
    arr.push(l);
    licensesByPurchase.set(l.purchaseId, arr);
  }

  const paymentsByPurchase = new Map(db.payments.map((p) => [p.purchaseId, p]));

  const subs = db.subscribers.filter((s) => isAdmin || s.userId === session.id || s.email === email);

  const out = purchases.map((p) => {
    const lics = (licensesByPurchase.get(p.id) ?? []).map((l) => {
      const master = db.masters.find((m) => m.id === l.masterId);
      const token = signDownload({
        l: l.id,
        m: l.masterId,
        e: Math.floor(Date.now() / 1000) + 3600,
        n: `${l.id}:${Date.now()}`,
      });
      return {
        ...l,
        fileReady: Boolean(master && !master.soldExclusive),
        fileName: master?.originalName ?? null,
        fileMissing: !master,
        downloadUrl: `/api/download?t=${encodeURIComponent(token)}`,
        certificateUrl: `/api/license?id=${encodeURIComponent(l.id)}`,
      };
    });

    return {
      id: p.id,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      total: p.total,
      lines: p.lines.map((l) => ({
        kind: l.kind,
        id: l.id,
        title: l.title,
        image: l.image,
        qty: l.qty,
        price: l.price,
        license: l.license,
        exclusive: l.license === "exclusive",
        subscriptionTitle: l.kind === "subscription" ? planById(l.id)?.title : undefined,
      })),
      payment: paymentsByPurchase.get(p.id)
        ? {
            provider: paymentsByPurchase.get(p.id)!.provider,
            status: paymentsByPurchase.get(p.id)!.status,
            refId: paymentsByPurchase.get(p.id)!.refId,
          }
        : null,
      licenses: lics,
      discountCode: p.discountCode,
      affiliateCode: p.affiliateCode,
    };
  });

  const activeSub = subs
    .filter((s) => s.status === "active" && new Date(s.expiresAt).getTime() > Date.now())
    .map((s) => ({ ...s, plan: planById(s.planId) ?? null }));

  return NextResponse.json({ ok: true, purchases: out, subscriptions: activeSub }, withNoStore());
}
