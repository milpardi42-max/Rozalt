import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { readDb } from "@/lib/commerce/store";
import { signCallback, isExpired, zarinpalMode } from "@/lib/commerce/zarinpal";
import { CashierClient } from "@/components/pay/CashierClient";

export const dynamic = "force-dynamic";

/**
 * Sandbox cashier — the fake-but-operable ZarinPal stand-in (فاز ۱).
 * Reached at /{locale}/pay/{authority}. Shows amount + success/fail buttons
 * that bounce back to the real callback route with an HMAC signature, so the
 * full buy → verify → licence → download loop is exercisable with no money.
 */

export async function generateMetadata({ params }: { params: Promise<{ authority: string }> }): Promise<Metadata> {
  const { authority } = await params;
  return { title: `پرداخت امن — ${authority.slice(0, 12)}…`, robots: { index: false } };
}

export default async function CashierPage({
  params,
}: {
  params: Promise<{ locale: string; authority: string }>;
}) {
  const { locale, authority } = await params;
  const db = await readDb();
  const payment = db.payments.find((p) => p.authority === authority);
  if (!payment) notFound();

  const purchase = db.purchases.find((p) => p.id === payment.purchaseId);
  if (!purchase) notFound();

  const expired = isExpired(payment.createdAt) || payment.status !== "created";
  const mode = zarinpalMode();
  const h = await headers();
  const fwdHost = h.get("x-forwarded-host");
  const host = fwdHost ?? h.get("host");
  const fwdProto = h.get("x-forwarded-proto");
  const proto = fwdProto ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  const origin = host ? `${proto}://${host.split(",")[0].trim()}` : "";
  const callbackBase = `${origin}/api/payments/zarinpal/callback`;

  return (
    <CashierClient
      locale={locale === "en" ? "en" : "fa"}
      authority={authority}
      amountFa={payment.amountFa}
      purchaseId={purchase.id}
      purchaseSummary={purchase.lines.map((l) => ({ title: l.title, qty: l.qty, priceFa: l.price.fa }))}
      buyerName={purchase.name}
      callbackUrl={callbackBase}
      sigOk={signCallback(authority, "OK")}
      sigNok={signCallback(authority, "NOK")}
      expired={expired}
      mode={mode}
      refId={payment.refId}
    />
  );
}
