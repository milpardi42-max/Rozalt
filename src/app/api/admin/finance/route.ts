import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb } from "@/lib/commerce/store";
import { getContent } from "@/lib/data/store";
import { SUBSCRIPTION_PLANS } from "@/lib/commerce/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/finance — Phase 3/5: consolidated finance overview
 * (payments, royalty ledger, settlements, discounts, subscriptions, outbox).
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const db = await readDb();
  const site = await getContent();
  const artistName = (id: string) => site.artists.find((a) => a.id === id)?.name.fa ?? id;

  const paidPayments = db.payments.filter((p) => p.status === "paid");
  const gmvFa = paidPayments.reduce((a, p) => a + p.amountFa, 0);
  const royaltyPending = db.royalties
    .filter((r) => !r.settlementId)
    .reduce((a, r) => a + r.amountFa, 0);
  const royaltyPaid = db.royalties
    .filter((r) => r.settlementId)
    .reduce((a, r) => a + r.amountFa, 0);

  return NextResponse.json(
    {
      ok: true,
      summary: {
        gmvFa,
        paidCount: paidPayments.length,
        pendingCount: db.payments.filter((p) => p.status === "created").length,
        failedCount: db.payments.filter((p) => p.status === "failed").length,
        royaltyPendingFa: royaltyPending,
        royaltyPaidFa: royaltyPaid,
        exclusiveSales: db.masters.filter((m) => m.soldExclusive).length,
        activeSubs: db.subscribers.filter(
          (s) => s.status === "active" && new Date(s.expiresAt).getTime() > Date.now(),
        ).length,
        pendingMasters: db.masters.filter((m) => m.status === "pending").length,
        outboxCount: db.outbox.length,
      },
      payments: db.payments
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map((p) => {
          const purchase = db.purchases.find((x) => x.id === p.purchaseId);
          return { ...p, buyerEmail: purchase?.email, buyerName: purchase?.name, lineCount: purchase?.lines.length ?? 0 };
        }),
      purchases: db.purchases
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map((p) => ({
          id: p.id,
          email: p.email,
          name: p.name,
          status: p.status,
          total: p.total,
          createdAt: p.createdAt,
          paidAt: p.paidAt,
          lines: p.lines.map((l) => ({ title: l.title, kind: l.kind, license: l.license, qty: l.qty, priceFa: l.price.fa })),
          discountCode: p.discountCode,
          affiliateCode: p.affiliateCode,
        })),
      royalties: db.royalties
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
        .map((r) => ({ ...r, artistLabel: artistName(r.artistId) })),
      settlements: db.settlements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      discounts: db.discounts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      subscribers: db.subscribers
        .slice()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 100)
        .map((s) => ({ ...s, plan: SUBSCRIPTION_PLANS.find((p) => p.id === s.planId) ?? null })),
      outbox: db.outbox.slice(-30).reverse(),
      masters: db.masters.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        sizeBytes: m.sizeBytes,
        originalName: m.originalName,
        patternId: m.patternId,
        artistId: m.artistId,
        virusScan: m.virusScan,
        analysis: m.analysis,
        soldExclusive: m.soldExclusive,
        downloadCount: m.downloadCount,
        reviewNote: m.reviewNote,
        createdAt: m.createdAt,
        hasPreview: Boolean(m.previewPath),
        mockupCount: m.mockupPaths?.length ?? 0,
      })),
      storage: {
        backend: process.env.UPSTASH_REDIS_REST_URL ? "redis" : "file",
        clamav: process.env.CLAMAV_HOST ? "configured" : "builtin",
        resend: process.env.RESEND_API_KEY ? "configured" : "outbox",
        stripe: process.env.STRIPE_SECRET_KEY ? "configured" : "off",
        zarinpalMode: process.env.ZARINPAL_MODE === "real" ? "real" : "sandbox",
      },
    },
    withNoStore(),
  );
}
