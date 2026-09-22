import { NextResponse } from "next/server";

import { getContent } from "@/lib/data/store";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { clientIp, tooManyAttempts, recordAttempt, retryAfterSeconds } from "@/lib/rate-limit";
import { withDb, newId, nowIso, readDb } from "@/lib/commerce/store";
import { startPayment, zarinpalMode } from "@/lib/commerce/zarinpal";
import { originFromRequest } from "@/lib/commerce/origin";
import { stripeConfigured, createCheckoutSession } from "@/lib/commerce/stripe";
import { patternUnitPrice } from "@/lib/commerce/fulfil";
import { planById } from "@/lib/commerce/plans";
import type { Purchase, PurchaseLine, LicenseType } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

const LICENSE_MULT: Record<string, number> = { personal: 1, commercial: 2.4, extended: 4, exclusive: 8 };

interface CheckoutBody {
  lines?: Array<{
    kind: "pattern" | "product" | "subscription";
    id: string;
    sku?: string;
    title?: string;
    image?: string;
    price?: { fa: number; en: number };
    qty?: number;
    license?: string;
  }>;
  name?: string;
  email?: string;
  provider?: "zarinpal" | "stripe";
  discountCode?: string;
  affiliateCode?: string;
  locale?: string;
}

/**
 * POST /api/payments/checkout — Phase 1 core.
 * Validates cart server-side against catalog prices, applies discounts,
 * creates a pending Purchase + Payment and returns the gateway redirect.
 */
export async function POST(req: Request) {
  const rlKey = `checkout:${clientIp(req)}`;
  if (tooManyAttempts(rlKey)) {
    const res = NextResponse.json({ ok: false, error: "too_many_attempts" }, withNoStore({ status: 429 }));
    const retry = retryAfterSeconds(rlKey);
    if (retry > 0) res.headers.set("Retry-After", String(retry));
    return res;
  }
  recordAttempt(rlKey);

  const body = (await req.json().catch(() => null)) as CheckoutBody | null;
  const session = await getSession();

  /* Email is authoritative from the session when logged in (subscription
     flows and guest checkout both land here). */
  const email = session?.email?.trim().toLowerCase() || body?.email?.trim().toLowerCase();
  const name = session?.name?.trim() || body?.name?.trim();
  if (!body?.lines?.length || !email || !name) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, withNoStore({ status: 400 }));
  }

  const site = await getContent();
  const db = await readDb();

  /* ── server-side price validation (never trust the client) ────────── */
  const lines: PurchaseLine[] = [];
  for (const raw of body.lines) {
    const qty = Math.max(1, Math.min(999, raw.qty ?? 1));

    if (raw.kind === "subscription") {
      const plan = planById(raw.id);
      if (!plan) return NextResponse.json({ ok: false, error: "unknown_plan" }, withNoStore({ status: 400 }));
      lines.push({
        kind: "subscription",
        id: plan.id,
        sku: plan.id.toUpperCase(),
        title: plan.title.fa,
        image: "/images/collections/s01.jpg",
        price: plan.price,
        qty: 1,
      });
      continue;
    }

    if (raw.kind === "pattern") {
      const pattern = site.patterns.find((p) => p.id === raw.id);
      if (!pattern) {
        return NextResponse.json({ ok: false, error: "pattern_not_found", id: raw.id }, withNoStore({ status: 404 }));
      }
      /* exclusive patterns already sold → reject */
      const master = db.masters.find((m) => m.patternId === pattern.id && m.soldExclusive);
      if (master) {
        return NextResponse.json({ ok: false, error: "sold_exclusive" }, withNoStore({ status: 409 }));
      }
      const licKey = raw.license && LICENSE_MULT[raw.license] ? raw.license : "commercial";
      const price = patternUnitPrice(pattern.price.fa, pattern.price.en, LICENSE_MULT[licKey]!);
      lines.push({
        kind: "pattern",
        id: pattern.id,
        sku: pattern.sku,
        title: `${pattern.title.fa} — ${licKey}`,
        image: pattern.image,
        price,
        qty: 1, // digital goods: one licence per line
        license: licKey as Exclude<LicenseType, "subscription">,
        ...(pattern.artistId ? { artistId: pattern.artistId } : {}),
      });
      continue;
    }

    if (raw.kind === "product") {
      const product = site.products.find((p) => p.id === raw.id);
      if (!product) {
        return NextResponse.json({ ok: false, error: "product_not_found", id: raw.id }, withNoStore({ status: 404 }));
      }
      lines.push({
        kind: "product",
        id: product.id,
        sku: product.sku,
        title: product.title.fa,
        image: product.colors[0]?.image ?? "/images/products/placeholder.jpg",
        price: product.price,
        qty,
        ...(product.artistId ? { artistId: product.artistId } : {}),
      });
      continue;
    }

    return NextResponse.json({ ok: false, error: "unknown_line_kind" }, withNoStore({ status: 400 }));
  }

  /* ── discount / affiliate ─────────────────────────────────────────── */
  let totalFa = lines.reduce((a, l) => a + l.price.fa * l.qty, 0);
  let totalEn = lines.reduce((a, l) => a + l.price.en * l.qty, 0);
  let discountAmountFa = 0;
  let discountCode: string | undefined;
  let affiliateCode: string | undefined;

  const codeRaw = body.discountCode?.trim().toUpperCase();
  if (codeRaw) {
    const d = db.discounts.find((x) => x.code === codeRaw && x.active);
    const expired = d?.expiresAt && new Date(d.expiresAt).getTime() < Date.now();
    const exhausted = d && d.maxUses > 0 && d.usedCount >= d.maxUses;
    if (d && !expired && !exhausted) {
      if (d.kind === "percent") discountAmountFa = Math.round((totalFa * d.value) / 100);
      else if (d.kind === "fixed") discountAmountFa = Math.min(totalFa, d.value);
      else affiliateCode = d.code; // affiliate gives no direct discount
      if (d.kind !== "affiliate") discountCode = d.code;
    } else {
      return NextResponse.json({ ok: false, error: "invalid_discount" }, withNoStore({ status: 400 }));
    }
  }

  const affRaw = body.affiliateCode?.trim().toUpperCase();
  if (!affiliateCode && affRaw) {
    const a = db.discounts.find((x) => x.code === affRaw && x.kind === "affiliate" && x.active);
    if (a) affiliateCode = a.code;
  }

  totalFa = Math.max(0, totalFa - discountAmountFa);
  totalEn = Math.max(0, Math.round((totalEn * totalFa) / Math.max(1, lines.reduce((a, l) => a + l.price.fa * l.qty, 0))));

  const purchase: Purchase = {
    id: newId("pur"),
    ...(session ? { userId: session.id } : {}),
    email: email!,
    name: name!,
    lines,
    total: { fa: totalFa, en: totalEn },
    status: "pending_payment",
    ...(discountCode ? { discountCode } : {}),
    ...(discountAmountFa ? { discountAmountFa } : {}),
    ...(affiliateCode ? { affiliateCode } : {}),
    locale: body.locale === "en" ? "en" : "fa",
    createdAt: nowIso(),
  };

  const provider = body.provider === "stripe" && stripeConfigured() ? "stripe" : "zarinpal";
  const origin = originFromRequest(req);

  try {
    if (provider === "stripe") {
      const { sessionId, url } = await createCheckoutSession({
        purchaseId: purchase.id,
        amountUsdCents: Math.max(50, Math.round(totalEn * 100)),
        email: purchase.email,
        successUrl: `${origin}/api/payments/stripe/return?purchase=${purchase.id}&locale=${purchase.locale}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/${purchase.locale}/checkout?error=payment_failed`,
      });
      await withDb((d) => {
        d.purchases.push(purchase);
        d.payments.push({
          id: newId("pay"),
          authority: sessionId,
          purchaseId: purchase.id,
          provider: "stripe",
          amountFa: totalFa,
          amountUsdCents: Math.max(50, Math.round(totalEn * 100)),
          status: "created",
          createdAt: nowIso(),
        });
      });
      return NextResponse.json({ ok: true, redirectUrl: url, purchaseId: purchase.id, provider }, withNoStore());
    }

    /* ZarinPal (sandbox by default) */
    const start = await startPayment({
      purchaseId: purchase.id,
      amountFa: totalFa,
      callbackPath: "/api/payments/zarinpal/callback",
    });

    await withDb((d) => {
      d.purchases.push(purchase);
      d.payments.push({
        id: newId("pay"),
        authority: start.authority,
        purchaseId: purchase.id,
        provider: "zarinpal",
        amountFa: totalFa,
        // ZarinPal Rial amount = toman × 10 — kept for parity with real gateway
        amountUsdCents: Math.max(50, Math.round(totalEn * 100)),
        status: "created",
        createdAt: nowIso(),
      });
    });

    const sep = start.redirectUrl.includes("?") ? "&" : "?";
    return NextResponse.json(
      {
        ok: true,
        redirectUrl: `${start.redirectUrl}${sep}amount=${totalFa}&purchase=${purchase.id}`,
        purchaseId: purchase.id,
        provider: "zarinpal",
        mode: zarinpalMode(),
      },
      withNoStore(),
    );
  } catch (e) {
    console.error("[checkout] failed:", e);
    return NextResponse.json({ ok: false, error: "checkout_failed" }, withNoStore({ status: 502 }));
  }
}
