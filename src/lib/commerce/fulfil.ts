import "server-only";
import { getContent, updateCollection } from "@/lib/data/store";
import { createOrder } from "@/lib/data/orders";
import { sendDeliveryEmail } from "./mail";
import { absoluteOrigin } from "./origin";
import { signDownload } from "./signed";
import { newId, nowIso, type withDb } from "./store";
import type { Purchase, PurchaseLine } from "./types";

type Db = Awaited<ReturnType<typeof import("./store").readDb>>;

export const LICENSE_FA: Record<string, string> = {
  personal: "شخصی",
  commercial: "تجاری",
  extended: "گسترده",
  exclusive: "انحصاری",
  subscription: "اشتراک",
};

/**
 * Fulfil a paid purchase (فاز ۱–۳ — idempotent):
 *   1. flip purchase → paid
 *   2. mirror a confirmed legacy Order (admin BuyersManager keeps working)
 *   3. issue licences + signed download URLs for every linked approved master
 *   4. record royalty ledger entries (artist share per revenueSharePct)
 *   5. exclusive sale → lock master + auto-delist the pattern from the catalog
 *   6. subscription line → activate Subscriber record
 *   7. bump discount usage · enqueue delivery e-mail (outbox / Resend)
 */
export async function fulfilPurchase(
  mutate: typeof withDb,
  purchaseId: string,
  meta: { refId?: string },
): Promise<{ ok: boolean; error?: string }> {
  let mail: { to: string; subject: string; links: { label: string; url: string }[] } | null = null;
  let locale: string = "fa";

  const result = await mutate(async (db) => {
    const purchase = db.purchases.find((p) => p.id === purchaseId);
    if (!purchase) return { ok: false as const, error: "purchase_not_found" };
    if (purchase.status === "paid") return { ok: true as const }; // idempotent replay
    if (purchase.status === "cancelled") return { ok: false as const, error: "purchase_cancelled" };

    purchase.status = "paid";
    purchase.paidAt = nowIso();
    void meta; // refId is persisted on the Payment record by the caller
    locale = purchase.locale === "en" ? "en" : "fa";
    const site = await getContent();

    /* ── legacy order mirror (products & patterns both appear there) ── */
    try {
      await createOrder({
        userId: purchase.userId,
        name: purchase.name,
        email: purchase.email,
        phone: "",
        address: "",
        city: "",
        postal: "",
        lines: purchase.lines
          .filter((l) => l.kind !== "subscription")
          .map((l) => ({
            kind: l.kind === "pattern" ? ("pattern" as const) : ("product" as const),
            id: l.id,
            sku: l.sku,
            title: l.title,
            image: l.image,
            price: l.price,
            qty: l.qty,
          })),
        total: purchase.total,
      });
    } catch (e) {
      console.error("[fulfil] order mirror failed:", e);
    }

    const links: { label: string; url: string }[] = [];

    for (const line of purchase.lines) {
      /* ── subscription line ─────────────────────────────────────── */
      if (line.kind === "subscription") {
        const { planById } = await import("./plans");
        const plan = planById(line.id);
        if (plan) {
          const start = Date.now();
          db.subscribers.push({
            id: newId("sub"),
            planId: plan.id,
            ...(purchase.userId ? { userId: purchase.userId } : {}),
            email: purchase.email,
            startedAt: new Date(start).toISOString(),
            expiresAt: new Date(start + plan.days * 86_400_000).toISOString(),
            downloadsUsed: 0,
            status: "active",
          });
        }
        continue;
      }

      /* ── physical product: order mirror is enough ──────────────── */
      if (line.kind !== "pattern") continue;

      /* ── resolve linked approved master (optional — physical file may
         still be in review; exclusive lock/delist must not depend on it) ── */
      const master = db.masters
        .filter((m) => m.patternId === line.id && m.status === "approved" && !m.soldExclusive)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      const artist = line.artistId ? site.artists.find((a) => a.id === line.artistId) : null;
      const pct = artist?.revenueSharePct ?? 0;

      if (master) {
        /* licence + signed download */
        const licenseId = newId("lic");
        const { certificateNo } = await import("./signed");
        const license = {
          id: licenseId,
          purchaseId: purchase.id,
          masterId: master.id,
          ...(line.id ? { patternId: line.id } : {}),
          type: line.license ?? "commercial",
          holderName: purchase.name,
          holderEmail: purchase.email,
          certificateNo: certificateNo(licenseId),
          issuedAt: nowIso(),
        };
        db.licenses.push(license);
        master.downloadCount += 1;

        const token = signDownload({
          l: licenseId,
          m: master.id,
          e: Math.floor(Date.now() / 1000) + 3600,
          n: newId("n"),
        });
        links.push({
          label: `${line.title} — ${LICENSE_FA[license.type] ?? license.type}`,
          url: `${absoluteOrigin()}/api/download?t=${encodeURIComponent(token)}`,
        });
        links.push({
          label: `${locale === "fa" ? "گواهی لایسنس" : "Licence certificate"} ${license.certificateNo}`,
          url: `${absoluteOrigin()}/api/license?id=${licenseId}`,
        });

        /* royalty ledger */
        if (artist && pct > 0) {
          db.royalties.push({
            id: newId("ryl"),
            kind: "sale",
            purchaseId: purchase.id,
            licenseId,
            artistId: artist.id,
            amountFa: Math.round((line.price.fa * line.qty * pct) / 100),
            pct,
            createdAt: nowIso(),
          });
        }
      }

      /* Phase 2 — exclusive sale: lock the master + auto-delist pattern
         (runs even when no approved master file is linked yet). */
      if (line.license === "exclusive") {
        for (const m of db.masters.filter((x) => x.patternId === line.id)) {
          m.soldExclusive = true;
        }
        const pattern = site.patterns.find((p) => p.id === line.id);
        if (pattern) {
          line.patternBackup = pattern;
          try {
            await updateCollection(
              "patterns",
              site.patterns.filter((p) => p.id !== line.id),
            );
            // keep local copy in sync for any later lines in this fulfil
            site.patterns = site.patterns.filter((p) => p.id !== line.id);
          } catch (e) {
            console.error("[fulfil] exclusive delist failed:", e);
          }
        }
      }
    }

    /* ── affiliate commission (phase 5) ─────────────────────────────── */
    if (purchase.discountCode && purchase.affiliateCode) {
      const aff = db.discounts.find((d) => d.code === purchase.affiliateCode && d.kind === "affiliate");
      if (aff?.artistId) {
        const artist = site.artists.find((a) => a.id === aff.artistId);
        if (artist) {
          db.royalties.push({
            id: newId("ryl"),
            kind: "affiliate",
            purchaseId: purchase.id,
            artistId: artist.id,
            amountFa: Math.round((purchase.total.fa * aff.value) / 100),
            pct: aff.value,
            createdAt: nowIso(),
          });
        }
      }
    }

    /* ── discount usage counter ─────────────────────────────────────── */
    if (purchase.discountCode) {
      const d = db.discounts.find((x) => x.code === purchase.discountCode);
      if (d) d.usedCount += 1;
    }

    mail = {
      to: purchase.email,
      subject:
        locale === "fa"
          ? `خرید موفق — لینک‌های دانلود شما (سفارش ${purchase.id})`
          : `Purchase complete — your download links (order ${purchase.id})`,
      links: links.length
        ? links
        : [{ label: locale === "fa" ? "مشاهده سفارش" : "View order", url: `${absoluteOrigin()}/${locale}/account` }],
    };

    return { ok: true as const };
  });

  if (result.ok && mail) {
    const m = mail as { to: string; subject: string; links: { label: string; url: string }[] };
    await sendDeliveryEmail(m);
  }
  return result;
}

/** Helper used by checkout: recompute a pattern unit price exactly like the UI. */
export function patternUnitPrice(baseFa: number, baseEn: number, mult: number): { fa: number; en: number } {
  return { fa: Math.round((baseFa * mult) / 10000) * 10000, en: Math.round(baseEn * mult) };
}

export type { Purchase, PurchaseLine, Db };
