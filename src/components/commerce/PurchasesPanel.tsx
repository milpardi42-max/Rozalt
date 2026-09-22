"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { useLocale } from "@/components/providers/AppProviders";
import { SESSION_FETCH } from "@/lib/http";
import { formatPrice, href } from "@/lib/utils";

interface PurchaseLicense {
  id: string;
  certificateNo: string;
  type: string;
  downloadUrl: string;
  certificateUrl: string;
  fileReady: boolean;
  fileMissing?: boolean;
  fileName: string | null;
  issuedAt: string;
}

interface PurchaseRow {
  id: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  total: { fa: number; en: number };
  lines: Array<{
    kind: string; title: string; image: string; qty: number;
    price: { fa: number; en: number }; license?: string; exclusive?: boolean;
    subscriptionTitle?: { fa: string; en: string };
  }>;
  payment: { provider: string; status: string; refId?: string } | null;
  licenses: PurchaseLicense[];
  discountCode?: string;
  affiliateCode?: string;
}

interface SubRow {
  id: string;
  planId: string;
  expiresAt: string;
  downloadsUsed: number;
  status: string;
  plan: { title: { fa: string; en: string }; price: { fa: number; en: number }; downloadsIncluded: number } | null;
}

interface PlanRow {
  id: string;
  title: { fa: string; en: string };
  price: { fa: number; en: number };
  days: number;
  downloadsIncluded: number;
}

const LICENSE_FA: Record<string, string> = {
  personal: "شخصی", commercial: "تجاری", extended: "گسترده",
  exclusive: "انحصاری", subscription: "اشتراک",
};

/**
 * حساب کاربری → خریدهای دیجیتال (Phase 1/2/5):
 * purchase history · signed download buttons · certificate PDF ·
 * active subscription + plan upgrade (ZarinPal sandbox checkout).
 */
export function PurchasesPanel() {
  const { locale, dict } = useLocale();
  const fa = locale === "fa";

  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [pRes, dRes] = await Promise.all([
        fetch("/api/purchases", { ...SESSION_FETCH }),
        fetch("/api/discounts", { ...SESSION_FETCH }),
      ]);
      if (!pRes.ok) throw new Error();
      const p = (await pRes.json()) as { purchases: PurchaseRow[]; subscriptions: SubRow[] };
      setRows(p.purchases);
      setSubs(p.subscriptions);
      if (dRes.ok) {
        const d = (await dRes.json()) as { plans?: PlanRow[] };
        setPlans(d.plans ?? []);
      }
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Buy a subscription plan through the ZarinPal sandbox (Phase 5). */
  const buyPlan = async (planId: string) => {
    setBusyPlan(planId);
    try {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      const r = await fetch("/api/payments/checkout", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [
            {
              kind: "subscription",
              id: planId,
              sku: planId.toUpperCase(),
              title: plan.title[locale],
              image: "/images/collections/s01.jpg",
              price: plan.price,
              qty: 1,
            },
          ],
          name: fa ? "مشترک اشتراک" : "Subscriber",
          email: "",
          provider: "zarinpal",
          locale,
        }),
      });
      const d = (await r.json()) as { ok: boolean; redirectUrl?: string; error?: string };
      if (d.ok && d.redirectUrl) {
        window.location.assign(d.redirectUrl);
        return;
      }
      alert(fa ? `خطا: ${d.error ?? "نامشخص"}` : `Error: ${d.error ?? "unknown"}`);
    } finally {
      setBusyPlan(null);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-error">{fa ? "خطا در بارگذاری خریدها." : "Failed to load purchases."}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>{dict.common.retry ?? "Retry"}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* subscription status + plans */}
      <section className="rounded-2xl border border-border bg-surface shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="font-semibold">{fa ? "اشتراک دانلود" : "Download subscription"}</p>
          <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="p-5">
          {subs.length > 0 ? (
            <ul className="space-y-2">
              {subs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{s.plan?.title[locale] ?? s.planId}</p>
                    <p className="text-caption text-muted">
                      {fa ? "اعتبار تا" : "Valid until"} {new Date(s.expiresAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                      {" · "}
                      {s.plan?.downloadsIncluded === -1
                        ? (fa ? "دانلود نامحدود" : "unlimited downloads")
                        : `${s.downloadsUsed}/${s.plan?.downloadsIncluded ?? 0} ${fa ? "دانلود" : "downloads"}`}
                    </p>
                  </div>
                  <Badge tone="success">{fa ? "فعال" : "Active"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-foreground-secondary">
              {fa ? "اشترکی فعال ندارید. یکی از طرح‌های زیر را انتخاب کنید:" : "No active subscription. Pick a plan:"}
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-background-secondary p-4">
                <p className="text-sm font-semibold">{p.title[locale]}</p>
                <p className="mt-1 font-display text-h3 tabular text-accent">{formatPrice(p.price, locale)}</p>
                <p className="mt-0.5 text-caption text-muted">
                  {p.downloadsIncluded === -1
                    ? (fa ? "دانلود نامحدود" : "Unlimited downloads")
                    : `${p.downloadsIncluded} ${fa ? "دانلود در ماه" : "downloads"}`}
                  {" · "}
                  {fa ? `${p.days} روز` : `${p.days} days`}
                </p>
                <Button size="sm" className="mt-3 w-full" disabled={busyPlan === p.id} onClick={() => void buyPlan(p.id)}>
                  {busyPlan === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {fa ? "خرید اشتراک" : "Subscribe"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* purchases */}
      <section className="rounded-2xl border border-border bg-surface shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="font-semibold">{fa ? "خریدهای دیجیتال من" : "My digital purchases"}</p>
          <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="p-5">
          {!rows ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={fa ? "هنوز خریدی ندارید." : "No purchases yet."}
              action={
                <Button href={href(locale, "/patterns")} size="sm" variant="outline">
                  {fa ? "مرور پترن‌ها" : "Browse patterns"}
                </Button>
              }
            />
          ) : (
            <ul className="space-y-4">
              {rows.map((p) => (
                <li key={p.id} className="rounded-xl border border-border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm" dir="ltr">{p.id}</p>
                      <Badge tone={p.status === "paid" ? "success" : p.status === "pending_payment" ? "warning" : "error"}>
                        {p.status === "paid" ? (fa ? "پرداخت‌شده" : "Paid") : p.status === "pending_payment" ? (fa ? "در انتظار" : "Pending") : p.status === "cancelled" ? (fa ? "لغو" : "Cancelled") : (fa ? "ناموفق" : "Failed")}
                      </Badge>
                      {p.payment?.refId && (
                        <span className="text-caption text-muted" dir="ltr">Ref: {p.payment.refId}</span>
                      )}
                    </div>
                    <div className="text-left">
                      <p className="font-semibold tabular">{formatPrice(p.total, locale)}</p>
                      <p className="text-caption text-muted">{new Date(p.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}</p>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {p.lines.map((l, i) => (
                      <li key={i} className="flex items-center gap-3 text-sm">
                        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={l.image} alt="" className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.subscriptionTitle ? l.subscriptionTitle[locale] : l.title}</span>
                        {l.license && (
                          <Badge tone={l.license === "exclusive" ? "accent" : "outline"}>
                            {LICENSE_FA[l.license] ?? l.license}
                          </Badge>
                        )}
                        <span className="tabular text-foreground-secondary">{formatPrice(l.price, locale)} × {l.qty}</span>
                      </li>
                    ))}
                  </ul>

                  {/* licenses: download + certificate */}
                  {p.licenses.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      {p.licenses.map((l) => (
                        <div key={l.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-caption text-muted" dir="ltr">{l.certificateNo}</span>
                          <Badge tone="outline">{LICENSE_FA[l.type] ?? l.type}</Badge>
                          {l.fileMissing ? (
                            <span className="text-caption text-warning">
                              {fa ? "فایل ماستر هنوز آپلود/تأیید نشده" : "Master file not ready yet"}
                            </span>
                          ) : (
                            <a
                              href={l.downloadUrl}
                              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-caption font-medium text-background transition hover:bg-accent hover:text-white"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {fa ? "دانلود امن" : "Secure download"}
                            </a>
                          )}
                          <a
                            href={l.certificateUrl}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-caption font-medium transition hover:border-accent hover:text-accent"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {fa ? "گواهی PDF" : "Certificate PDF"}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
