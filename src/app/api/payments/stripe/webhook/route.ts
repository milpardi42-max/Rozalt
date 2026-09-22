import { NextResponse } from "next/server";
import { withNoStore } from "@/lib/http";
import { withDb } from "@/lib/commerce/store";
import { verifyWebhookSignature, retrieveSession, stripeConfigured } from "@/lib/commerce/stripe";
import { fulfilPurchase } from "@/lib/commerce/fulfil";
import { nowIso, newId } from "@/lib/commerce/store";
import { readDb } from "@/lib/commerce/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/stripe/webhook — Phase 4.
 * Verifies the Stripe-Signature header (HMAC over `${t}.${payload}`), then
 * fulfils the matching purchase exactly once.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, withNoStore({ status: 503 }));
  }

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyWebhookSignature(payload, sig)) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, withNoStore({ status: 400 }));
  }

  let event: { type?: string; data?: { object?: { id?: string; metadata?: { purchaseId?: string }; payment_status?: string } } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, withNoStore({ status: 400 }));
  }

  const obj = event.data?.object;
  if (event.type === "checkout.session.completed" && obj?.id) {
    const db = await readDb();
    const payment = db.payments.find((p) => p.authority === obj.id);
    if (payment && payment.status !== "paid") {
      let purchaseId = payment.purchaseId;
      /* belt & braces: re-read session from Stripe API */
      try {
        const s = await retrieveSession(obj.id);
        if (s.paymentStatus !== "paid") {
          return NextResponse.json({ ok: true, ignored: "unpaid" }, withNoStore());
        }
        if (s.purchaseId) purchaseId = s.purchaseId;
      } catch (e) {
        console.error("[stripe] session retrieve failed:", e);
      }

      await withDb((d) => {
        const p = d.payments.find((x) => x.authority === obj.id);
        if (p && p.status !== "paid") {
          p.status = "paid";
          p.refId = newId("ref");
          p.paidAt = nowIso();
        }
      });
      const result = await fulfilPurchase(withDb, purchaseId, {});
      return NextResponse.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) }, withNoStore());
    }
  }

  return NextResponse.json({ ok: true, ignored: true }, withNoStore());
}
