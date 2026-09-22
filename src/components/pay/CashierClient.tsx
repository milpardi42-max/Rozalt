"use client";

import { useState } from "react";
import { BadgeCheck, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";

interface Props {
  locale: "fa" | "en";
  authority: string;
  amountFa: number;
  purchaseId: string;
  purchaseSummary: { title: string; qty: number; priceFa: number }[];
  buyerName: string;
  callbackUrl: string;
  sigOk: string;
  sigNok: string;
  expired: boolean;
  mode: "sandbox" | "real";
  refId?: string;
}

/**
 * Fake gateway UI — visually distinct from the store (dark bank page),
 * with success / failure outcomes that carry the HMAC callback signature.
 */
export function CashierClient(p: Props) {
  const fa = p.locale === "fa";
  const [busy, setBusy] = useState<"ok" | "nok" | null>(null);

  const go = (outcome: "OK" | "NOK") => {
    setBusy(outcome.toLowerCase() as "ok" | "nok");
    const u = new URL(p.callbackUrl);
    u.searchParams.set("Authority", p.authority);
    u.searchParams.set("Status", outcome);
    u.searchParams.set("sig", outcome === "OK" ? p.sigOk : p.sigNok);
    u.searchParams.set("locale", p.locale);
    window.location.assign(u.toString());
  };

  if (p.expired) {
    return (
      <Shell locale={p.locale}>
        <div className="text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-400" />
          <h2 className="mt-4 text-xl font-bold text-white">
            {fa ? "این درگاه منقضی شده است" : "This payment session expired"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {fa
              ? "رسید پرداخت قبلاً تسویه یا منقضی شده. از سبد خرید دوباره اقدام کنید."
              : "This session was already settled or expired. Start again from your cart."}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell locale={p.locale}>
      <div className="flex items-center justify-between border-b border-slate-700 pb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <span className="font-bold text-white">
            {fa ? "درگاه پرداخت زرین‌پال" : "ZarinPal Gateway"}
          </span>
        </div>
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
          {p.mode === "sandbox" ? (fa ? "حالت آزمایشی" : "SANDBOX") : "LIVE"}
        </span>
      </div>

      {/* amount */}
      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/60 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-slate-400">
          {fa ? "مبلغ قابل پرداخت" : "Amount due"}
        </p>
        <p className="mt-2 text-3xl font-extrabold text-white tabular">
          {formatPrice({ fa: p.amountFa, en: 0 }, p.locale)}
        </p>
        <p className="mt-1 text-xs text-slate-400" dir="ltr">
          {fa ? `خریدار: ${p.buyerName}` : `Buyer: ${p.buyerName}`} · {p.purchaseId}
        </p>
      </div>

      {/* line items */}
      <ul className="mt-4 space-y-2">
        {p.purchaseSummary.map((l, i) => (
          <li key={i} className="flex items-center justify-between rounded-lg border border-slate-700/70 px-4 py-2.5 text-sm">
            <span className="text-slate-200">{l.title}</span>
            <span className="text-slate-400 tabular" dir="ltr">
              ×{l.qty} · {l.priceFa.toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ul>

      {/* fake card form — cosmetic only, mirrors a real gateway */}
      <div className="mt-6 grid gap-3">
        <input
          dir="ltr"
          defaultValue="6274  ****  ****  3849"
          readOnly
          aria-label="card"
          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-300 outline-none"
        />
        <div className="grid grid-cols-2 gap-3">
          <input dir="ltr" defaultValue="12/28" readOnly aria-label="exp" className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-300 outline-none" />
          <input dir="ltr" defaultValue="***" readOnly aria-label="cvv2" className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-300 outline-none" />
        </div>
        <input dir="ltr" defaultValue="12345" readOnly aria-label="pin" className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-300 outline-none" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button
          onClick={() => go("OK")}
          disabled={busy !== null}
          className="h-12 w-full bg-emerald-600 text-white hover:bg-emerald-500"
        >
          {busy === "ok" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
          {fa ? "پرداخت موفق" : "Payment successful"}
        </Button>
        <Button
          onClick={() => go("NOK")}
          disabled={busy !== null}
          variant="outline"
          className="h-12 w-full border-slate-600 text-slate-300 hover:border-red-400 hover:text-red-300"
        >
          {busy === "nok" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          {fa ? "پرداخت ناموفق" : "Payment failed"}
        </Button>
      </div>

      <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">
        {fa
          ? "این صفحه شبیه‌ساز درگاه زرین‌پال است (حالت آزمایشی). هیچ مبلغ واقعی کسر نمی‌شود؛ برای تست خرید و فروش، «پرداخت موفق» را بزنید."
          : "This is a ZarinPal simulator (test mode). No real money moves — hit “Payment successful” to exercise the full purchase flow."}
      </p>
    </Shell>
  );
}

function Shell({ locale, children }: { locale: "fa" | "en"; children: React.ReactNode }) {
  const fa = locale === "fa";
  return (
    <div dir={fa ? "rtl" : "ltr"} className="min-h-screen bg-slate-900 px-4 py-10 font-sans">
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Rosie Atelier · {fa ? "درگاه امن" : "Secure checkout"}
        </p>
      </div>
    </div>
  );
}
