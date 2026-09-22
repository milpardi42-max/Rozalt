"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  BadgePercent,
  CreditCard,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input } from "@/components/ui/Input";
import { SESSION_FETCH } from "@/lib/http";
import { cn, faNum } from "@/lib/utils";

interface FinanceData {
  summary: {
    gmvFa: number;
    paidCount: number;
    pendingCount: number;
    failedCount: number;
    royaltyPendingFa: number;
    royaltyPaidFa: number;
    exclusiveSales: number;
    activeSubs: number;
    pendingMasters: number;
    outboxCount: number;
  };
  payments: Array<{
    id: string; authority: string; provider: string; status: string;
    amountFa: number; refId?: string; createdAt: string;
    buyerEmail?: string; buyerName?: string;
  }>;
  purchases: Array<{
    id: string; email: string; name: string; status: string;
    total: { fa: number }; createdAt: string; paidAt?: string;
    lines: Array<{ title: string; kind: string; license?: string; qty: number; priceFa: number }>;
    discountCode?: string; affiliateCode?: string;
  }>;
  royalties: Array<{
    id: string; kind: string; artistLabel: string; amountFa: number;
    pct: number; settlementId?: string; createdAt: string;
  }>;
  settlements: Array<{
    id: string; artistLabel?: string; artistId: string; amountFa: number;
    status: string; createdAt: string; paidAt?: string;
  }>;
  discounts: Array<{
    code: string; kind: string; value: number; maxUses: number;
    usedCount: number; active: boolean; expiresAt?: string; createdAt: string;
  }>;
  subscribers: Array<{
    id: string; email: string; startedAt: string; expiresAt: string;
    downloadsUsed: number; status: string;
    plan?: { title: { fa: string } } | null;
  }>;
  outbox: Array<{ id: string; to: string; subject: string; sentVia: string; createdAt: string; links: { label: string; url: string }[] }>;
  storage: { backend: string; clamav: string; resend: string; stripe: string; zarinpalMode: string };
}

type Tab = "overview" | "payments" | "royalties" | "discounts" | "subs" | "mail";

const money = (n: number) => `${faNum(n.toLocaleString("en-US"))} تومان`;

/**
 * Admin → مالی و رشد (فاز ۳ و ۵):
 * overview KPIs · payments/purchases · royalty ledger + settlements ·
 * discount/affiliate codes · subscriptions · delivery outbox.
 */
export function FinanceManager() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  /* new discount form */
  const [dCode, setDCode] = useState("");
  const [dKind, setDKind] = useState<"percent" | "fixed" | "affiliate">("percent");
  const [dValue, setDValue] = useState("10");
  const [dMax, setDMax] = useState("0");

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch("/api/admin/finance", { ...SESSION_FETCH });
      if (!r.ok) throw new Error();
      setData((await r.json()) as FinanceData);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/discounts", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          code: dCode,
          kind: dKind,
          value: Number(dValue),
          maxUses: Number(dMax) || 0,
        }),
      });
      if (r.ok) {
        setDCode("");
        await load();
      } else {
        const d = (await r.json()) as { error?: string };
        alert(d.error === "already_exists" ? "این کد قبلاً ثبت شده." : "خطا در ثبت کد.");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleDiscount = async (code: string) => {
    await fetch("/api/discounts", {
      ...SESSION_FETCH,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "toggle", code }),
    });
    await load();
  };

  const advanceSettlement = async (id: string) => {
    await fetch("/api/artist/earnings", {
      ...SESSION_FETCH,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "advance", settlementId: id }),
    });
    await load();
  };

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 text-center">
        <p className="text-sm text-error">خطا در بارگذاری داده‌های مالی.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>تلاش دوباره</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const { summary } = data;
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "نمای کلی", icon: <Wallet className="h-4 w-4" /> },
    { id: "payments", label: "پرداخت‌ها", icon: <CreditCard className="h-4 w-4" /> },
    { id: "royalties", label: "رویالی و تسویه", icon: <Banknote className="h-4 w-4" /> },
    { id: "discounts", label: "کد تخفیف / افیلیت", icon: <BadgePercent className="h-4 w-4" /> },
    { id: "subs", label: "اشتراک‌ها", icon: <Send className="h-4 w-4" /> },
    { id: "mail", label: `ایمیل‌ها (${data.outbox.length})`, icon: <Mail className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-h3">مالی و رشد</h2>
          <div className="mt-1.5 flex flex-wrap gap-2 text-caption">
            <Badge tone="accent">درگاه: {data.storage.zarinpalMode === "real" ? "زرین‌پال واقعی" : "زرین‌پال آزمایشی"}</Badge>
            <Badge tone={data.storage.stripe === "configured" ? "success" : "outline"}>
              Stripe: {data.storage.stripe === "configured" ? "فعال" : "غیرفعال"}
            </Badge>
            <Badge tone="outline">ClamAV: {data.storage.clamav === "configured" ? "clamd" : "heuristic"}</Badge>
            <Badge tone="outline">ایمیل: {data.storage.resend === "configured" ? "Resend" : "outbox"}</Badge>
            <Badge tone="outline">ذخیره: {data.storage.backend === "redis" ? "Redis" : "فایل"}</Badge>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
          بروزرسانی
        </Button>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-white p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-caption font-medium transition",
              tab === t.id ? "bg-foreground text-background" : "text-foreground-secondary hover:bg-background-secondary",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── overview ─────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "کل فروش (GMV)", value: money(summary.gmvFa), icon: <Banknote className="h-5 w-5" /> },
            { label: "پرداخت موفق", value: faNum(summary.paidCount), icon: <CreditCard className="h-5 w-5" /> },
            { label: "رویالی در انتظار", value: money(summary.royaltyPendingFa), icon: <Wallet className="h-5 w-5" /> },
            { label: "تسویه‌شده", value: money(summary.royaltyPaidFa), icon: <BadgePercent className="h-5 w-5" /> },
            { label: "فروش انحصاری", value: faNum(summary.exclusiveSales), icon: <Badge tone="accent">exclusive</Badge> as unknown as React.ReactNode },
            { label: "اشتراک فعال", value: faNum(summary.activeSubs), icon: <Send className="h-5 w-5" /> },
            { label: "ماستر در انتظار بازبینی", value: faNum(summary.pendingMasters), icon: <Mail className="h-5 w-5" /> },
            { label: "پرداخت ناموفق", value: faNum(summary.failedCount), icon: <CreditCard className="h-5 w-5" /> },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <span className="text-caption text-foreground-secondary">{kpi.label}</span>
                <span className="text-accent">{kpi.icon as React.ReactNode}</span>
              </div>
              <p className="mt-2 font-display text-h3 tabular">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── payments ─────────────────────────────────────────────── */}
      {tab === "payments" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-caption text-foreground-secondary">
                <th className="p-3 text-start">شناسه</th>
                <th className="p-3 text-start">خریدار</th>
                <th className="p-3 text-start">درگاه</th>
                <th className="p-3 text-start">مبلغ</th>
                <th className="p-3 text-start">وضعیت</th>
                <th className="p-3 text-start">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-mono text-caption" dir="ltr">{p.authority.slice(0, 14)}…</td>
                  <td className="p-3">{p.buyerName ?? "—"}<span className="block text-caption text-muted" dir="ltr">{p.buyerEmail}</span></td>
                  <td className="p-3">{p.provider === "stripe" ? "Stripe" : "زرین‌پال"}</td>
                  <td className="p-3 tabular">{money(p.amountFa)}</td>
                  <td className="p-3">
                    <Badge tone={p.status === "paid" ? "success" : p.status === "created" ? "warning" : "error"}>
                      {p.status === "paid" ? "پرداخت‌شده" : p.status === "created" ? "در انتظار" : "ناموفق"}
                    </Badge>
                  </td>
                  <td className="p-3 text-caption text-muted">{new Date(p.createdAt).toLocaleDateString("fa-IR")}</td>
                </tr>
              ))}
              {data.payments.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-sm text-muted">هنوز پرداختی ثبت نشده.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── royalties ────────────────────────────────────────────── */}
      {tab === "royalties" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-white shadow-soft">
            <div className="border-b border-border px-4 py-3 font-semibold">دفتر رویالی</div>
            <ul className="max-h-[480px] divide-y divide-border/60 overflow-y-auto">
              {data.royalties.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{r.artistLabel}</p>
                    <p className="text-caption text-muted">
                      {r.kind === "affiliate" ? "افیلیت" : r.kind === "subscription" ? "اشتراک" : "فروش"} · {r.pct}% ·{" "}
                      {new Date(r.createdAt).toLocaleDateString("fa-IR")}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="font-semibold tabular">{money(r.amountFa)}</p>
                    <p className="text-caption text-muted">{r.settlementId ? "تسویه‌شده" : "در انتظار"}</p>
                  </div>
                </li>
              ))}
              {data.royalties.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">موردی نیست.</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-white shadow-soft">
            <div className="border-b border-border px-4 py-3 font-semibold">درخواست‌های تسویه</div>
            <ul className="max-h-[480px] divide-y divide-border/60 overflow-y-auto">
              {data.settlements.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-mono text-caption" dir="ltr">{s.id}</p>
                    <p className="text-caption text-muted">{new Date(s.createdAt).toLocaleDateString("fa-IR")}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular">{money(s.amountFa)}</span>
                    <Badge tone={s.status === "paid" ? "success" : s.status === "processing" ? "warning" : "outline"}>
                      {s.status === "paid" ? "پرداخت‌شده" : s.status === "processing" ? "در حال" : "در انتظار"}
                    </Badge>
                    {s.status !== "paid" && (
                      <Button size="sm" variant="outline" onClick={() => void advanceSettlement(s.id)}>
                        {s.status === "pending" ? "تأیید →" : "پرداخت ✓"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {data.settlements.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">هنوز درخواست تسویه‌ای نیست.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── discounts ────────────────────────────────────────────── */}
      {tab === "discounts" && (
        <div className="grid gap-4 lg:grid-cols-5">
          <form onSubmit={createDiscount} className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-soft lg:col-span-2">
            <p className="font-semibold">کد جدید</p>
            <Field label="کد">
              <Input value={dCode} onChange={(e) => setDCode(e.target.value.toUpperCase())} placeholder="NOWRUZ1405" dir="ltr" required />
            </Field>
            <Field label="نوع">
              <select
                value={dKind}
                onChange={(e) => setDKind(e.target.value as typeof dKind)}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
              >
                <option value="percent">درصدی</option>
                <option value="fixed">مبلغی (تومان)</option>
                <option value="affiliate">افیلیت (پورسانت هنرمند)</option>
              </select>
            </Field>
            <Field label={dKind === "percent" ? "درصد (۱–۱۰۰)" : dKind === "fixed" ? "مبلغ تومان" : "پورسانت %"}>
              <Input type="number" min={1} value={dValue} onChange={(e) => setDValue(e.target.value)} required dir="ltr" />
            </Field>
            <Field label="سقف استفاده (۰ = نامحدود)">
              <Input type="number" min={0} value={dMax} onChange={(e) => setDMax(e.target.value)} dir="ltr" />
            </Field>
            <Button type="submit" size="sm" disabled={busy || !dCode}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              ثبت کد
            </Button>
          </form>

          <div className="rounded-xl border border-border bg-white shadow-soft lg:col-span-3">
            <div className="border-b border-border px-4 py-3 font-semibold">کدهای فعال</div>
            <ul className="max-h-[440px] divide-y divide-border/60 overflow-y-auto">
              {data.discounts.map((d) => (
                <li key={d.code} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-mono font-semibold" dir="ltr">{d.code}</p>
                    <p className="text-caption text-muted">
                      {d.kind === "percent" ? `${d.value}% تخفیف` : d.kind === "fixed" ? `${d.value} تومان` : `افیلیت ${d.value}%`}
                      {" · "}{d.usedCount}{d.maxUses > 0 ? `/${d.maxUses}` : ""} بار
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={d.active ? "success" : "outline"}>{d.active ? "فعال" : "غیرفعال"}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => void toggleDiscount(d.code)}>
                      {d.active ? "غیرفعال" : "فعال"}
                    </Button>
                  </div>
                </li>
              ))}
              {data.discounts.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">کدی ثبت نشده.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── subscriptions ────────────────────────────────────────── */}
      {tab === "subs" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-caption text-foreground-secondary">
                <th className="p-3 text-start">ایمیل</th>
                <th className="p-3 text-start">طرح</th>
                <th className="p-3 text-start">شروع</th>
                <th className="p-3 text-start">پایان</th>
                <th className="p-3 text-start">دانلود</th>
                <th className="p-3 text-start">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {data.subscribers.map((s) => {
                const active = s.status === "active" && new Date(s.expiresAt).getTime() > Date.now();
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="p-3" dir="ltr">{s.email}</td>
                    <td className="p-3">{s.plan?.title.fa ?? s.id}</td>
                    <td className="p-3 text-caption">{new Date(s.startedAt).toLocaleDateString("fa-IR")}</td>
                    <td className="p-3 text-caption">{new Date(s.expiresAt).toLocaleDateString("fa-IR")}</td>
                    <td className="p-3 tabular">{s.downloadsUsed}</td>
                    <td className="p-3"><Badge tone={active ? "success" : "outline"}>{active ? "فعال" : "منقضی"}</Badge></td>
                  </tr>
                );
              })}
              {data.subscribers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-sm text-muted">مشترکی نیست.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── outbox ───────────────────────────────────────────────── */}
      {tab === "mail" && (
        <div className="space-y-3">
          {data.outbox.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted">
              هنوز ایمیلی ارسال نشده. با هر خرید موفق، ایمیل لینک‌ها اینجا بایگانی می‌شود.
            </div>
          ) : (
            data.outbox.map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-white p-4 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{m.subject}</p>
                  <Badge tone={m.sentVia === "resend" ? "success" : "outline"}>{m.sentVia === "resend" ? "Resend" : "outbox"}</Badge>
                </div>
                <p className="mt-0.5 text-caption text-muted" dir="ltr">{m.to} · {new Date(m.createdAt).toLocaleString("fa-IR")}</p>
                <ul className="mt-2 space-y-1">
                  {m.links.map((l, i) => (
                    <li key={i} className="text-caption">
                      <span className="text-foreground-secondary">{l.label}: </span>
                      <a href={l.url} className="text-accent hover:underline" dir="ltr">{l.url.slice(0, 72)}…</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
