import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb, withDb, newId, nowIso } from "@/lib/commerce/store";
import { getContent } from "@/lib/data/store";

import { SUBSCRIPTION_PLANS } from "@/lib/commerce/plans";

export const dynamic = "force-dynamic";

/**
 * GET  /api/artist/earnings — Phase 3/5: royalty ledger + sales analytics
 *                              for the calling artist (admin sees all + settlements).
 * POST /api/artist/earnings — Phase 3: request settlement of pending royalties.
 */
export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "artist" && session.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const db = await readDb();
  const isAdmin = session.role === "admin";
  const artistId = session.artistId;

  const site = await getContent();
  const artistName = (id: string) => site.artists.find((a) => a.id === id)?.name.fa ?? id;

  const entries = db.royalties.filter((r) => (isAdmin ? true : r.artistId === artistId));
  const settledIds = new Set(db.settlements.filter((s) => s.status !== "pending").flatMap((s) => s.entryIds));
  const pending = entries.filter((r) => !r.settlementId && !settledIds.has(r.id));
  const paid = entries.filter((r) => r.settlementId || settledIds.has(r.id));

  const sum = (xs: typeof entries) => xs.reduce((a, r) => a + r.amountFa, 0);

  /* sales analytics — last 12 months buckets keyed by YYYY-MM */
  const buckets = new Map<string, { month: string; salesFa: number; royaltyFa: number; orders: Set<string> }>();
  const paidPurchases = db.purchases.filter((p) => p.status === "paid");
  for (const p of paidPurchases) {
    const ym = p.createdAt.slice(0, 7);
    if (!buckets.has(ym)) buckets.set(ym, { month: ym, salesFa: 0, royaltyFa: 0, orders: new Set() });
    const b = buckets.get(ym)!;
    const lines = p.lines.filter((l) => (isAdmin ? true : l.artistId === artistId));
    if (!lines.length) continue;
    b.salesFa += lines.reduce((a, l) => a + l.price.fa * l.qty, 0);
    b.orders.add(p.id);
  }
  for (const r of entries) {
    const ym = r.createdAt.slice(0, 7);
    if (!buckets.has(ym)) buckets.set(ym, { month: ym, salesFa: 0, royaltyFa: 0, orders: new Set() });
    buckets.get(ym)!.royaltyFa += r.amountFa;
  }

  const topWorks = new Map<string, { title: string; count: number; revenueFa: number }>();
  for (const p of paidPurchases) {
    for (const l of p.lines) {
      if (l.kind !== "pattern") continue;
      if (!isAdmin && l.artistId !== artistId) continue;
      const key = l.id;
      const cur = topWorks.get(key) ?? { title: l.title, count: 0, revenueFa: 0 };
      cur.count += l.qty;
      cur.revenueFa += l.price.fa * l.qty;
      topWorks.set(key, cur);
    }
  }

  /* subscriptions relevant to this artist's catalogue (admin overview) */
  const activeSubs = db.subscribers.filter(
    (s) => s.status === "active" && new Date(s.expiresAt).getTime() > Date.now(),
  ).length;

  const settlements = db.settlements.filter((s) => (isAdmin ? true : s.artistId === artistId));

  return NextResponse.json(
    {
      ok: true,
      summary: {
        pendingFa: sum(pending),
        paidFa: sum(paid),
        totalRoyaltiesFa: sum(entries),
        orderCount: paidPurchases.length,
        activeSubs,
        entryCount: entries.length,
      },
      entries: entries
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, artistLabel: artistName(r.artistId) })),
      settlements: settlements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      analytics: [...buckets.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12)
        .map((b) => ({ month: b.month, salesFa: b.salesFa, royaltyFa: b.royaltyFa, orders: b.orders.size })),
      topWorks: [...topWorks.values()].sort((a, b) => b.revenueFa - a.revenueFa).slice(0, 8),
      plans: SUBSCRIPTION_PLANS,
      role: session.role,
    },
    withNoStore(),
  );
}

/** POST — artist asks to cash out pending royalties (creates a settlement). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.role !== "artist" && session.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }
  const body = (await req.json().catch(() => null)) as { action?: string; settlementId?: string } | null;

  /* admin: advance settlement status */
  if (session.role === "admin" && body?.action === "advance" && body.settlementId) {
    let ok = false;
    await withDb((db) => {
      const s = db.settlements.find((x) => x.id === body.settlementId);
      if (!s) return;
      if (s.status === "pending") s.status = "processing";
      else if (s.status === "processing") { s.status = "paid"; s.paidAt = nowIso(); }
      ok = true;
    });
    return NextResponse.json({ ok }, withNoStore());
  }

  if (body?.action !== "request") {
    return NextResponse.json({ ok: false, error: "unknown_action" }, withNoStore({ status: 400 }));
  }
  if (!session.artistId) {
    return NextResponse.json({ ok: false, error: "no_artist_link" }, withNoStore({ status: 400 }));
  }

  let created: { id: string; amountFa: number } | null = null;
  await withDb((db) => {
    const pending = db.royalties.filter(
      (r) => r.artistId === session.artistId && !r.settlementId,
    );
    if (!pending.length) return;
    const amountFa = pending.reduce((a, r) => a + r.amountFa, 0);
    const id = newId("stl");
    for (const r of pending) r.settlementId = id;
    db.settlements.push({
      id,
      artistId: session.artistId!,
      amountFa,
      entryIds: pending.map((r) => r.id),
      status: "pending",
      createdAt: nowIso(),
    });
    created = { id, amountFa };
  });

  if (!created) {
    return NextResponse.json({ ok: false, error: "nothing_pending" }, withNoStore({ status: 400 }));
  }
  return NextResponse.json({ ok: true, settlement: created }, withNoStore());
}
