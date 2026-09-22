import { NextResponse } from "next/server";

import { readDb, withDb, nowIso, newId } from "@/lib/commerce/store";
import { retrieveSession, stripeConfigured } from "@/lib/commerce/stripe";
import { fulfilPurchase } from "@/lib/commerce/fulfil";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/stripe/return — browser return from Stripe Checkout.
 * Confirms payment_status=paid server-side, fulfils once, then redirects
 * back into the store with the same success contract as ZarinPal.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id") ?? "";
  const purchaseIdParam = url.searchParams.get("purchase") ?? "";
  const locale = url.searchParams.get("locale") === "en" ? "en" : "fa";

  if (!sessionId || !stripeConfigured()) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || ""}/${locale}/checkout?error=stripe_not_configured`);
  }

  const db = await readDb();
  const payment = db.payments.find((p) => p.authority === sessionId);
  const purchaseId = payment?.purchaseId ?? purchaseIdParam;
  if (!purchaseId) {
    return NextResponse.redirect(`/${locale}/checkout?error=unknown_session`);
  }

  if (payment && payment.status !== "paid") {
    try {
      const s = await retrieveSession(sessionId);
      if (s.paymentStatus === "paid") {
        await withDb((d) => {
          const p = d.payments.find((x) => x.authority === sessionId);
          if (p && p.status !== "paid") {
            p.status = "paid";
            p.refId = newId("ref");
            p.paidAt = nowIso();
          }
        });
        const r = await fulfilPurchase(withDb, purchaseId, {});
        if (!r.ok) {
          const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
          return NextResponse.redirect(`${origin}/${locale}/checkout?error=fulfil_failed&purchase=${purchaseId}`);
        }
      } else {
        const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
        return NextResponse.redirect(`${origin}/${locale}/checkout?error=payment_failed&purchase=${purchaseId}`);
      }
    } catch (e) {
      console.error("[stripe/return]", e);
      const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
      return NextResponse.redirect(`${origin}/${locale}/checkout?error=stripe_error&purchase=${purchaseId}`);
    }
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return NextResponse.redirect(`${origin}/${locale}/checkout?success=${purchaseId}&paid=1`);
}
