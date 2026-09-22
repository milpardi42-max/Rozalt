import "server-only";
import crypto from "crypto";

/**
 * Stripe integration (فاز ۴) — REST via fetch, no SDK required.
 * Activates only when STRIPE_SECRET_KEY is configured; otherwise routes
 * report "not_configured" and the UI hides the Stripe option.
 */

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function api(pathname: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  return fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  }).then(async (r) => {
    const data = (await r.json()) as Record<string, unknown> & { error?: { message?: string } };
    if (!r.ok) throw new Error(data.error?.message ?? `stripe_${r.status}`);
    return data;
  });
}

export async function createCheckoutSession(input: {
  purchaseId: string;
  amountUsdCents: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; url: string }> {
  const session = (await api("checkout/sessions", {
    mode: "payment",
    customer_email: input.email,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountUsdCents),
    "line_items[0][price_data][product_data][name]": `Rosie Atelier — ${input.purchaseId}`,
    "metadata[purchaseId]": input.purchaseId,
  })) as { id?: string; url?: string };

  if (!session.id || !session.url) throw new Error("stripe_session_failed");
  return { sessionId: session.id, url: session.url };
}

export async function retrieveSession(sessionId: string): Promise<{
  paymentStatus: string;
  purchaseId: string | null;
}> {
  const body = new URLSearchParams().toString();
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    cache: "no-store",
  });
  const data = (await r.json()) as { payment_status?: string; metadata?: { purchaseId?: string }; error?: { message?: string } };
  if (!r.ok) throw new Error(data.error?.message ?? `stripe_${r.status}`);
  return {
    paymentStatus: data.payment_status ?? "unpaid",
    purchaseId: data.metadata?.purchaseId ?? null,
  };
}

/** Stripe webhook signature verification (t=…,v1=hmac_sha256(secret, `${t}.${payload}`)) */
export function verifyWebhookSignature(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (age > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${payload}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}
