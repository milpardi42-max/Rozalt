"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useAuth, useCart, useLocale } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Sku } from "@/components/ui/Badge";
import { EmptyState, SuccessState } from "@/components/ui/States";
import { SESSION_FETCH } from "@/lib/http";
import { cn, formatPrice, href } from "@/lib/utils";

export function CheckoutView() {
  const { lines, clear } = useCart();
  const { locale, dict } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState("");
  const fa = locale === "fa";
  const total = lines.reduce(
    (acc, l) => ({ fa: acc.fa + l.price.fa * l.qty, en: acc.en + l.price.en * l.qty }),
    { fa: 0, en: 0 },
  );

  /* Return-from-gateway: ?success=<purchaseId>&paid=1 (or error=…) */
  const gwSuccess = search.get("success");
  const gwPaid = search.get("paid");
  const gwError = search.get("error");
  useEffect(() => {
    if (gwSuccess && gwPaid === "1") {
      // Only clear when the paid flag is present — cancelled sessions keep the cart.
      clear();
      setDone(gwSuccess);
    } else if (gwError) {
      const map: Record<string, string> = {
        payment_failed: fa ? "پرداخت ناموفق بود. دوباره تلاش کنید." : "Payment failed. Try again.",
        no_authority: fa ? "جلسه پرداخت نامعتبر است." : "Invalid payment session.",
        unknown_authority: fa ? "جلسه پرداخت منقضی شده است." : "Payment session expired.",
        fulfil_failed: fa ? "پرداخت انجام شد اما تحویل با خطا مواجه شد؛ با پشتیبانی تماس بگیرید." : "Paid but delivery failed — contact support.",
        invalid_discount: fa ? "کد تخفیف معتبر نیست." : "Invalid discount code.",
        sold_exclusive: fa ? "این اثر به‌صورت انحصاری فروخته شده است." : "This work was sold exclusively.",
      };
      setError(map[gwError] ?? (fa ? "خطا در پرداخت." : "Payment error."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwSuccess, gwPaid, gwError]);

  if (done) {
    return (
      <div className="container-x max-w-xl pt-[calc(var(--header-h)+4rem)] pb-20">
        <SuccessState
          message={`${fa ? "پرداخت شما با موفقیت انجام شد. کد پیگیری" : "Payment successful. Reference"}: ${done}`}
        />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href={href(locale, "/account")} variant="accent">
            {fa ? "دانلودها و گواهی‌ها" : "Downloads & certificates"}
          </Button>
          <Button href={href(locale, "/")} variant="outline">
            {dict.common.continueShopping}
          </Button>
        </div>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="container-x max-w-xl pt-[calc(var(--header-h)+4rem)] pb-20">
        <EmptyState
          title={dict.common.emptyCart}
          description={dict.common.emptyCartDesc}
          action={
            <Button href={href(locale, "/shop")} size="sm" variant="outline">
              {dict.common.continueShopping}
            </Button>
          }
        />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);

    const orderLines = lines.map((l) => ({
      kind: l.kind,
      id: l.id,
      sku: l.sku,
      title: l.title,
      image: l.image,
      price: l.price,
      colorName: l.colorName,
      qty: l.qty,
    }));

    try {
      const r = await fetch("/api/orders", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email") || user?.email,
          phone: fd.get("phone"),
          address: fd.get("address"),
          city: fd.get("city"),
          postal: fd.get("postal"),
          lines: orderLines,
        }),
      });
      const d = (await r.json()) as { ok: boolean; orderId?: string; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "server_error");
      clear();
      setDone(d.orderId ?? "—");
      router.refresh();
    } catch {
      setError(fa ? "خطا در ثبت سفارش. لطفاً دوباره تلاش کنید." : "Order failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Phase 1 — ZarinPal gateway checkout (sandbox by default).
   * The cart is re-validated server-side, a pending purchase is created and
   * the browser is sent to the cashier; on return the cart clears via ?paid=1.
   */
  const startGatewayPayment = async (provider: "zarinpal" | "stripe") => {
    setPayBusy(true);
    setError("");
    try {
      const form = document.getElementById("co-form") as HTMLFormElement | null;
      const fd = form ? new FormData(form) : new FormData();
      const name = String(fd.get("name") || user?.name || "").trim();
      const email = String(fd.get("email") || user?.email || "").trim();
      if (!name || !email) {
        throw new Error("missing_buyer");
      }

      const r = await fetch("/api/payments/checkout", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            kind: l.kind,
            id: l.id,
            sku: l.sku,
            title: l.title,
            image: l.image,
            price: l.price,
            qty: l.qty,
          })),
          name,
          email,
          provider,
          locale,
        }),
      });
      const d = (await r.json()) as { ok: boolean; redirectUrl?: string; error?: string };
      if (!r.ok || !d.ok || !d.redirectUrl) {
        throw new Error(d.error ?? "checkout_failed");
      }
      window.location.assign(d.redirectUrl);
    } catch (e) {
      const code = (e as Error).message;
      const map: Record<string, string> = {
        missing_buyer: fa ? "نام و ایمیل را در فرم وارد کنید." : "Fill in your name and email first.",
        invalid_discount: fa ? "کد تخفیف معتبر نیست." : "Invalid discount code.",
        sold_exclusive: fa ? "این اثر به‌صورت انحصاری فروخته رفته." : "Sold exclusively.",
        pattern_not_found: fa ? "یکی از آیتم‌ها دیگر موجود نیست." : "An item is no longer available.",
        product_not_found: fa ? "یکی از آیتم‌ها دیگر موجود نیست." : "An item is no longer available.",
        unknown_plan: fa ? "طرح اشتراک نامعتبر است." : "Invalid subscription plan.",
        stripe_not_configured: fa ? "Stripe پیکربندی نشده." : "Stripe is not configured.",
      };
      setError(map[code] ?? (fa ? "خطا در شروع پرداخت. دوباره تلاش کنید." : "Could not start payment."));
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div className="container-x pt-[calc(var(--header-h)+2.5rem)] pb-20">
      <h1 className="font-display text-h1">{dict.common.checkout}</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        <form id="co-form" className="space-y-4 lg:col-span-7" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dict.common.name}>
              <Input name="name" required autoComplete="name" defaultValue={user?.name ?? ""} />
            </Field>
            <Field label={dict.common.phone}>
              <Input name="phone" type="tel" required dir="ltr" autoComplete="tel" />
            </Field>
            <Field label={dict.common.email}>
              <Input
                name="email"
                type="email"
                required
                dir="ltr"
                autoComplete="email"
                defaultValue={user?.email ?? ""}
              />
            </Field>
            <Field label={dict.common.city}>
              <Input name="city" required autoComplete="address-level2" />
            </Field>
            <div className="sm:col-span-2">
              <Field label={dict.common.address}>
                <Input name="address" required autoComplete="street-address" />
              </Field>
            </div>
            <Field label={dict.common.postal}>
              <Input name="postal" dir="ltr" autoComplete="postal-code" />
            </Field>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {dict.common.placeOrder}
          </Button>
        </form>

        <aside className="lg:col-span-5">
          <div className="rounded-lg border border-border p-5">
            <ul className="divide-y divide-border">
              {lines.map((l) => (
                <li key={l.key} className="flex gap-3 py-3">
                  <span className="relative h-16 w-14 shrink-0 overflow-hidden rounded-md bg-background-secondary">
                    <Image src={l.image} alt="" fill sizes="56px" className="object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{l.title}</span>
                    <span className="mt-1 flex items-center gap-2 text-caption text-foreground-secondary">
                      <Sku value={l.sku} />
                      {l.colorName && <span>{l.colorName}</span>}
                      <span>× {l.qty}</span>
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular">
                    {formatPrice({ fa: l.price.fa * l.qty, en: l.price.en * l.qty }, locale)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-foreground-secondary">{dict.common.total}</span>
              <span className="font-display text-h3 tabular">{formatPrice(total, locale)}</span>
            </div>
            <p className="mt-2 text-caption text-muted">{dict.common.shippingNote}</p>
          </div>

          {/* Phase 1 — online gateway (ZarinPal sandbox; Stripe when configured) */}
          <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold">
                {fa ? "پرداخت اینترنتی" : "Online payment"}
              </p>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {fa ? "آزمایشی" : "SANDBOX"}
              </span>
            </div>
            <p className="mt-1.5 text-caption text-foreground-secondary">
              {fa
                ? "با درگاه زرین‌پال (حالت آزمایشی) بخرید؛ بعد از پرداخت، لینک دانلود امن و گواهی PDF لایسنس صادر می‌شود."
                : "Pay via the ZarinPal sandbox; on success you get a secure signed download link and a PDF licence certificate."}
            </p>
            <div className="mt-3 grid gap-2">
              <Button
                type="button"
                size="lg"
                variant="accent"
                className="w-full"
                disabled={payBusy}
                onClick={() => void startGatewayPayment("zarinpal")}
              >
                {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {fa ? `پرداخت با زرین‌پال — ${formatPrice(total, locale)}` : `Pay with ZarinPal — ${formatPrice(total, locale)}`}
              </Button>
              <p className={cn("text-center text-caption", error ? "text-error" : "text-muted")}>
                {error || (fa ? "قفل سبد خرید تا بازگشت از درگاه حفظ می‌شود." : "Your cart is kept while you are at the gateway.")}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
