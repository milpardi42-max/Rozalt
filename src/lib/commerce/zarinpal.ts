import "server-only";
import crypto from "crypto";
import { signValue, verifyValue } from "./signed";

/**
 * ZarinPal gateway — FAKE-but-operational sandbox (فاز ۱).
 *
 * Mirrors the real ZarinPal flow shape so swapping in production later is a
 * drop-in change:
 *
 *   real:    Request()  → authority      → StartPay URL → callback(OK/NOK) → Verify()
 *   sandbox: startPayment() → authority  → /{locale}/pay/{authority} cashier page
 *                                       → callback(OK/NOK) → verifyPayment()
 *
 * The cashier page (src/app/[locale]/pay/…) simulates the bank page: any card
 * number passes when "success" is chosen, "fail" produces NOK — so buy & sell
 * can be exercised end-to-end without real money.
 *
 * Set ZARINPAL_MODE=real + ZARINPAL_MERCHANT_ID to route to production
 * (payment.zarinpal.com) — the public function signatures stay identical.
 */

const SANDBOX_TTL_MS = 30 * 60 * 1000; // 30 min to complete payment

export function zarinpalMode(): "sandbox" | "real" {
  return process.env.ZARINPAL_MODE === "real" && process.env.ZARINPAL_MERCHANT_ID
    ? "real"
    : "sandbox";
}

export function newAuthority(): string {
  // Same shape as real ZarinPal authorities: A + 36 hex chars
  return `A${crypto.randomBytes(18).toString("hex").toUpperCase()}`;
}

/** Toman → Rial (ZarinPal charges Rial) */
export const tomanToRial = (toman: number) => Math.round(toman) * 10;

export interface StartPaymentInput {
  purchaseId: string;
  amountFa: number;
  callbackPath: string; // e.g. /api/payments/zarinpal/callback
}

export interface StartPaymentResult {
  authority: string;
  /** Where to send the user's browser */
  redirectUrl: string;
}

export async function startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
  const authority = newAuthority();

  if (zarinpalMode() === "real") {
    // Production path — real ZarinPal v4 "Request" API.
    const res = await fetch("https://payment.zarinpal.com/pg/v4/payment/request.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: tomanToRial(input.amountFa),
        callback_url: `${absoluteOrigin()}${input.callbackPath}`,
        description: `Rosie Atelier — order ${input.purchaseId}`,
      }),
    });
    const data = (await res.json()) as { data?: { authority?: string; code?: number }; errors?: unknown[] };
    const auth = data.data?.authority;
    if (!auth) throw new Error(`zarinpal_request_failed: ${JSON.stringify(data.errors ?? data)}`);
    return {
      authority: auth,
      redirectUrl: `https://payment.zarinpal.com/pg/StartPay/${auth}`,
    };
  }

  // Sandbox path — authority is self-issued; cashier is our own page.
  return {
    authority,
    redirectUrl: `${absoluteOrigin()}/pay/${authority}`,
  };
}

export function absoluteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT ?? 3000}`;
}

/* ── callback signature (protects fake gateway callbacks from forgery) ── */

export function signCallback(authority: string, outcome: "OK" | "NOK"): string {
  return signValue(["zp", authority, outcome]);
}

export function verifyCallback(authority: string, outcome: string, sig: string): boolean {
  if (outcome !== "OK" && outcome !== "NOK") return false;
  return verifyValue(["zp", authority, outcome], sig);
}

export function newRefId(): string {
  // Real ZarinPal ref ids are numeric
  return String(crypto.randomInt(100_000_000, 10_000_000_000));
}

export function isExpired(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > SANDBOX_TTL_MS;
}
