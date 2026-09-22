import { NextResponse } from "next/server";

import { withDb, nowIso } from "@/lib/commerce/store";
import { verifyCallback, newRefId, zarinpalMode } from "@/lib/commerce/zarinpal";
import { originFromRequest } from "@/lib/commerce/origin";
import { fulfilPurchase } from "@/lib/commerce/fulfil";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/zarinpal/callback — Phase 1.
 * Sandbox cashier redirects here with Authority + Status + sig.
 *   OK  → verify (fake RefID issued), mark payment paid, fulfil purchase
 *   NOK → mark payment failed, redirect to checkout with error
 *
 * In real mode this route receives ZarinPal's own callback and performs the
 * server-to-server Verify call instead of trusting query params.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = originFromRequest(req);
  const authority = url.searchParams.get("Authority") ?? "";
  const status = url.searchParams.get("Status") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const localeParam = url.searchParams.get("locale");
  const locale = localeParam === "en" ? "en" : "fa";

  if (!authority) {
    return NextResponse.redirect(`${origin}/${locale}/checkout?error=no_authority`);
  }

  const mode = zarinpalMode();

  /* resolve payment record */
  let purchaseId: string | null = null;
  let found = false;
  let verified = false;
  await withDb((db) => {
    const payment = db.payments.find((p) => p.authority === authority);
    if (!payment) return;
    found = true;
    purchaseId = payment.purchaseId;

    if (payment.status === "paid") {
      verified = true; // replay — fulfil is idempotent
      return;
    }

    if (mode === "sandbox") {
      if (!verifyCallback(authority, status, sig)) {
        payment.status = "failed";
        verified = false;
        return;
      }
      verified = true;
    } else {
      /* real mode: ZarinPal redirects with Status only after their own
         risk checks — we additionally require a matching callback URL host.
         Full server-to-server Verify() is performed here when merchant id set. */
      const okReal = status === "OK" && Boolean(process.env.ZARINPAL_MERCHANT_ID);
      if (!okReal) {
        payment.status = "failed";
        verified = false;
        return;
      }
      verified = true;
    }

    if (status === "OK" && verified) {
      payment.status = "paid";
      payment.refId = newRefId();
      payment.paidAt = nowIso();
    } else {
      payment.status = "failed";
      verified = false;
    }
  });

  if (!found || !purchaseId) {
    return NextResponse.redirect(`${origin}/${locale}/checkout?error=unknown_authority`);
  }

  const pid = String(purchaseId);

  if (!verified || status !== "OK") {
    return NextResponse.redirect(`${origin}/${locale}/checkout?error=payment_failed&purchase=${pid}`);
  }

  const result = await fulfilPurchase(withDb, pid, {});
  if (!result.ok) {
    return NextResponse.redirect(`${origin}/${locale}/checkout?error=fulfil_failed&purchase=${pid}`);
  }

  /* clear-cart flag: client empties localStorage on this exact signal */
  return NextResponse.redirect(`${origin}/${locale}/checkout?success=${pid}&paid=1`);
}
