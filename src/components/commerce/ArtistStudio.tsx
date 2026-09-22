"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  FileArchive,
  FileUp,
  Loader2,
  RefreshCw,
  Send,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { useLocale } from "@/components/providers/AppProviders";
import { SESSION_FETCH } from "@/lib/http";
import { cn, faNum } from "@/lib/utils";

interface MasterRow {
  id: string;
  title: string;
  originalName: string;
  sizeBytes: number;
  status: "pending" | "approved" | "rejected";
  reviewNote?: string;
  patternId?: string;
  virusScan: { status: string; engine: string };
  analysis?: { score: number; seamless: boolean };
  mockupPaths?: string[];
  licenseCount?: number;
  downloadCount: number;
  soldExclusive?: boolean;
  previewPath?: string;
  createdAt: string;
}

interface EarningsData {
  summary: { pendingFa: number; paidFa: number; totalRoyaltiesFa: number; orderCount: number; entryCount: number };
  entries: Array<{ id: string; kind: string; amountFa: number; pct: number; createdAt: string; settlementId?: string }>;
  settlements: Array<{ id: string; amountFa: number; status: string; createdAt: string; paidAt?: string }>;
  analytics: Array<{ month: string; salesFa: number; royaltyFa: number; orders: number }>;
  topWorks: Array<{ title: string; count: number; revenueFa: number }>;
}

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const money = (n: number) => `${faNum(n.toLocaleString("en-US"))} تومان`;

/* ── single-shot / multipart uploader ───────────────────────────── */
const SINGLE_LIMIT = 64 * 1024 * 1024;

async function uploadMaster(
  file: File,
  meta: { title: string; description: string },
  onProgress?: (pct: number) => void,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  /* Phase 4 — files over 64 MB use the presigned multipart flow */
  if (file.size > SINGLE_LIMIT) {
    const initRes = await fetch("/api/master/multipart?action=init", {
      ...SESSION_FETCH,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, title: meta.title, description: meta.description }),
    });
    const init = (await initRes.json()) as {
      ok: boolean; error?: string;
      uploadId?: string; partSize?: number; partUrls?: { partNumber: number; url: string }[];
    };
    if (!init.ok || !init.uploadId || !init.partUrls) return { ok: false, error: init.error ?? "init_failed" };

    for (let i = 0; i < init.partUrls.length; i++) {
      const part = init.partUrls[i];
      const blob = file.slice((i) * init.partSize!, (i + 1) * init.partSize!);
      const r = await fetch(part.url, { ...SESSION_FETCH, method: "POST", body: blob });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: d.error ?? "part_failed", detail: `part ${part.partNumber}` };
      }
      onProgress?.(Math.round(((i + 1) / init.partUrls.length) * 100));
    }

    const done = await fetch("/api/master/multipart?action=complete", {
      ...SESSION_FETCH,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId }),
    });
    const doneJson = (await done.json()) as { ok: boolean; error?: string; detail?: string };
    return doneJson.ok ? { ok: true } : { ok: false, error: doneJson.error, detail: doneJson.detail };
  }

  /* Phase 1 — single-shot */
  const fd = new FormData();
  fd.set("file", file);
  fd.set("title", meta.title);
  fd.set("description", meta.description);
  const r = await fetch("/api/master/upload", { ...SESSION_FETCH, method: "POST", body: fd });
  const d = (await r.json()) as { ok: boolean; error?: string; detail?: string };
  if (d.ok) onProgress?.(100);
  return d;
}

/**
 * Artist studio — Phase 1 private upload + Phase 3 royalty earnings.
 * Rendered as an extra tab inside the artist dashboard (additive).
 */
export function ArtistStudio() {
  const { locale } = useLocale();
  const fa = locale === "fa";

  const [tab, setTab] = useState<"upload" | "files" | "earnings">("upload");

  /* upload state */
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* files state */
  const [rows, setRows] = useState<MasterRow[] | null>(null);

  /* earnings state */
  const [earn, setEarn] = useState<EarningsData | null>(null);
  const [earnBusy, setEarnBusy] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch("/api/master/mine", { ...SESSION_FETCH });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { masters: MasterRow[] };
      setRows(d.masters);
    } catch {
      setRows([]);
    }
  }, []);

  const loadEarn = useCallback(async () => {
    try {
      const r = await fetch("/api/artist/earnings", { ...SESSION_FETCH });
      if (!r.ok) throw new Error();
      setEarn((await r.json()) as EarningsData);
    } catch {
      setEarn(null);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);
  useEffect(() => {
    if (tab === "earnings") void loadEarn();
  }, [tab, loadEarn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setProgress(0);
    try {
      const res = await uploadMaster(file, { title, description: desc }, setProgress);
      if (res.ok) {
        setMsg({ ok: true, text: fa ? "فایل آپلود شد و در صف بازبینی ادمین است." : "Uploaded — awaiting admin review." });
        setFile(null);
        setTitle("");
        setDesc("");
        if (fileRef.current) fileRef.current.value = "";
        void loadFiles();
        setTab("files");
      } else {
        const detail = res.detail ? ` (${res.detail})` : "";
        const map: Record<string, string> = {
          virus_detected: fa ? "ویروس شناسایی شد — فایل پذیرفته نشد." : "Virus detected — file rejected.",
          unsupported_type: fa ? "فرمت فایل پشتیبانی نمی‌شود." : "Unsupported file type.",
          use_multipart: fa ? "فایل بزرگ‌تر از حد مجاز است." : "File exceeds single-shot limit.",
          too_many_attempts: fa ? "تعداد درخواست‌ها زیاد است؛ کمی صبر کنید." : "Too many attempts — slow down.",
        };
        setMsg({ ok: false, text: (map[res.error ?? ""] ?? (fa ? "آپلود ناموفق بود." : "Upload failed.")) + detail });
      }
    } catch {
      setMsg({ ok: false, text: fa ? "خطای شبکه." : "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const requestSettlement = async () => {
    setEarnBusy(true);
    try {
      const r = await fetch("/api/artist/earnings", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const d = (await r.json()) as { ok: boolean; error?: string; settlement?: { amountFa: number } };
      if (d.ok) {
        alert(fa ? `درخواست تسویه ${money(d.settlement!.amountFa)} ثبت شد.` : `Settlement requested.`);
        await loadEarn();
      } else if (d.error === "nothing_pending") {
        alert(fa ? "مبلغی برای تسویه وجود ندارد." : "Nothing pending.");
      }
    } finally {
      setEarnBusy(false);
    }
  };

  const tabs = [
    { id: "upload" as const, label: fa ? "آپلود ماستر" : "Upload master", icon: <FileUp className="h-4 w-4" /> },
    { id: "files" as const, label: fa ? `فایل‌های من (${rows?.length ?? 0})` : `My files (${rows?.length ?? 0})`, icon: <FileArchive className="h-4 w-4" /> },
    { id: "earnings" as const, label: fa ? "درآمد" : "Earnings", icon: <Wallet className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition",
              tab === t.id ? "bg-accent/10 text-accent" : "text-foreground-secondary hover:bg-background-secondary",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── upload ─────────────────────────────────────────────── */}
      {tab === "upload" && (
        <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-soft">
          <div>
            <h3 className="font-display text-h3">{fa ? "آپلود فایل ماستر (خصوصی)" : "Upload master file (private)"}</h3>
            <p className="mt-1 text-caption text-foreground-secondary">
              {fa
                ? "فایل در فضای خصوصی سرور ذخیره می‌شود و پس از تأیید ادمین، فقط خریداران با لینک امضاشده به آن دسترسی دارند. برای فایل‌های بالای ۶۴ مگابایت آپلود تکه‌تکه (Multipart) خودکار انجام می‌شود."
                : "Stored in private server storage; only verified buyers get signed links after admin review. Files > 64 MB switch to presigned multipart automatically."}
            </p>
          </div>

          <Field label={fa ? "عنوان" : "Title"}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={fa ? "مثلاً: باغ اسلیمی — نسخه ماستر PSD" : "e.g. Eslimi garden — master PSD"} />
          </Field>
          <Field label={fa ? "توضیحات (اختیاری)" : "Description (optional)"}>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </Field>

          <div
            className={cn(
              "rounded-xl border-2 border-dashed p-6 text-center transition",
              file ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) {
                setFile(f);
                if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }
            }}
          >
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
              accept=".jpg,.jpeg,.png,.webp,.avif,.tif,.tiff,.pdf,.svg,.psd,.ai,.zip,.rar,.7z"
            />
            <FileUp className="mx-auto h-8 w-8 text-accent" />
            {file ? (
              <div className="mt-3">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-caption text-muted" dir="ltr">{fmtSize(file.size)}</p>
                <button type="button" className="mt-1 text-caption text-error hover:underline" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>
                  {fa ? "حذف" : "Remove"}
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-foreground-secondary">
                {fa ? "فایل را اینجا رها کنید یا کلیک کنید" : "Drop a file here or click to browse"}
                <br />
                <span className="text-caption text-muted">PSD · AI · PDF · ZIP · PNG · JPG · WEBP · TIFF …</span>
              </p>
            )}
            {!file && (
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => fileRef.current?.click()}>
                {fa ? "انتخاب فایل" : "Browse"}
              </Button>
            )}
          </div>

          {busy && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-background-secondary">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-caption text-muted">{fa ? `در حال آپلود… ${progress}%` : `Uploading… ${progress}%`}</p>
            </div>
          )}

          {msg && (
            <p className={cn("rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-success/10 text-success" : "bg-error/10 text-error")}>
              {msg.text}
            </p>
          )}

          <Button type="submit" disabled={busy || !file || !title}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {fa ? "آپلود امن" : "Secure upload"}
          </Button>
        </form>
      )}

      {/* ── files ──────────────────────────────────────────────── */}
      {tab === "files" && (
        <div className="rounded-2xl border border-border bg-surface shadow-soft">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="font-semibold">{fa ? "فایل‌های ماستر من" : "My master files"}</p>
            <Button size="sm" variant="ghost" onClick={() => void loadFiles()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="max-h-[560px] divide-y divide-border/70 overflow-y-auto">
            {!rows && (
              <li className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-accent" /></li>
            )}
            {rows?.length === 0 && (
              <li className="p-10 text-center text-sm text-muted">
                {fa ? "هنوز فایلی آپلود نکرده‌اید." : "No files yet."}
              </li>
            )}
            {rows?.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-background-secondary">
                  {m.previewPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.previewPath} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-muted"><FileArchive className="h-5 w-5" /></span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <Badge tone={m.status === "approved" ? "success" : m.status === "rejected" ? "error" : "warning"}>
                      {m.status === "approved" ? (fa ? "تأیید" : "Approved") : m.status === "rejected" ? (fa ? "رد" : "Rejected") : (fa ? "در انتظار" : "Pending")}
                    </Badge>
                    {m.soldExclusive && <Badge tone="accent">{fa ? "انحصاری — فروخته‌شده" : "Exclusive — sold"}</Badge>}
                  </div>
                  <p className="text-caption text-muted" dir="ltr">
                    {m.originalName} · {fmtSize(m.sizeBytes)} · {m.downloadCount} {fa ? "دانلود" : "downloads"} · {m.licenseCount ?? 0} {fa ? "لایسنس" : "licences"}
                  </p>
                  <div className="flex gap-3 text-caption">
                    <span className={m.virusScan.status === "clean" ? "text-success" : "text-error"}>
                      {m.virusScan.status === "clean" ? "✓" : "⚠"} {m.virusScan.engine}
                    </span>
                    {m.analysis && (
                      <span className={m.analysis.seamless ? "text-success" : "text-warning"}>
                        {fa ? "بی‌درز" : "Seamless"}: {Math.round(m.analysis.score * 100)}%
                      </span>
                    )}
                  </div>
                  {m.reviewNote && <p className="text-caption text-error">{m.reviewNote}</p>}
                </div>
                <div className="flex gap-2">
                  {m.mockupPaths && m.mockupPaths.length > 0 && (
                    <div className="flex gap-1">
                      {m.mockupPaths.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt="" className="h-10 w-14 rounded border border-border object-cover" />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── earnings ───────────────────────────────────────────── */}
      {tab === "earnings" && (
        <div className="space-y-4">
          {!earn ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: fa ? "در انتظار تسویه" : "Pending", value: money(earn.summary.pendingFa), tone: "text-warning" },
                  { label: fa ? "تسویه‌شده" : "Settled", value: money(earn.summary.paidFa), tone: "text-success" },
                  { label: fa ? "کل رویالی" : "Total royalties", value: money(earn.summary.totalRoyaltiesFa), tone: "text-accent" },
                  { label: fa ? "سفارش‌های فروش" : "Paid orders", value: faNum(earn.summary.orderCount), tone: "text-foreground" },
                ].map((k) => (
                  <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-soft">
                    <p className="text-caption text-foreground-secondary">{k.label}</p>
                    <p className={cn("mt-1.5 font-display text-h3 tabular", k.tone)}>{k.value}</p>
                  </div>
                ))}
              </div>

              {/* monthly chart (pure CSS bars) */}
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
                <p className="font-semibold">{fa ? "فروش ماهانه" : "Monthly sales"}</p>
                <div className="mt-4 flex h-40 items-end gap-2">
                  {(() => {
                    const max = Math.max(1, ...earn.analytics.map((a) => a.salesFa));
                    return earn.analytics.length === 0 ? (
                      <p className="self-center text-sm text-muted">{fa ? "داده‌ای هنوز ثبت نشده." : "No data yet."}</p>
                    ) : (
                      earn.analytics.map((a) => (
                        <div key={a.month} className="group relative flex-1">
                          <div
                            className="w-full rounded-t-md bg-accent/80 transition group-hover:bg-accent"
                            style={{ height: `${Math.max(4, (a.salesFa / max) * 140)}px` }}
                          />
                          <p className="mt-1 text-center text-[9px] text-muted">{a.month.slice(5)}/{a.month.slice(2, 4)}</p>
                          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background opacity-0 transition group-hover:opacity-100">
                            {money(a.salesFa)}
                          </span>
                        </div>
                      ))
                    );
                  })()}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border bg-surface shadow-soft">
                  <div className="border-b border-border px-5 py-3.5 font-semibold">{fa ? "آخرین رویالی‌ها" : "Recent royalties"}</div>
                  <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">
                    {earn.entries.slice(0, 12).map((r) => (
                      <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                        <div>
                          <p className="text-caption text-muted">
                            {r.kind === "affiliate" ? (fa ? "افیلیت" : "Affiliate") : fa ? "فروش" : "Sale"} · {r.pct}% · {new Date(r.createdAt).toLocaleDateString("fa-IR")}
                          </p>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold tabular">{money(r.amountFa)}</p>
                          <p className="text-caption text-muted">{r.settlementId ? (fa ? "پرداخت‌شده" : "Paid") : (fa ? "در انتظار" : "Pending")}</p>
                        </div>
                      </li>
                    ))}
                    {earn.entries.length === 0 && (
                      <li className="p-8 text-center text-sm text-muted">{fa ? "هنوز فروشی نداشته‌اید." : "No sales yet."}</li>
                    )}
                  </ul>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
                    <p className="font-semibold">{fa ? "پرفروش‌ترین آثار" : "Top works"}</p>
                    <ul className="mt-3 space-y-2">
                      {earn.topWorks.map((w, i) => (
                        <li key={i} className="flex items-center justify-between text-sm">
                          <span className="truncate">{w.title}</span>
                          <span className="shrink-0 tabular text-foreground-secondary">{money(w.revenueFa)}</span>
                        </li>
                      ))}
                      {earn.topWorks.length === 0 && <li className="text-sm text-muted">—</li>}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
                    <div className="flex items-center gap-2">
                      <Banknote className="h-5 w-5 text-accent" />
                      <p className="font-semibold">{fa ? "تسویه‌ی هنرمندان" : "Artist settlement"}</p>
                    </div>
                    <p className="mt-2 text-caption text-foreground-secondary">
                      {fa
                        ? `موجودی قابل درخواست: ${money(earn.summary.pendingFa)} — با یک کلیک به ادمین ارجاع داده می‌شود.`
                        : `Requestable balance: ${money(earn.summary.pendingFa)} — one click sends it to admin.`}
                    </p>
                    <Button size="sm" className="mt-3" disabled={earnBusy || earn.summary.pendingFa <= 0} onClick={() => void requestSettlement()}>
                      {earnBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {fa ? "درخواست تسویه" : "Request settlement"}
                    </Button>
                    {earn.settlements.length > 0 && (
                      <ul className="mt-3 space-y-1 text-caption">
                        {earn.settlements.slice(0, 5).map((s) => (
                          <li key={s.id} className="flex justify-between">
                            <span className="text-muted">{new Date(s.createdAt).toLocaleDateString("fa-IR")}</span>
                            <span className={s.status === "paid" ? "text-success" : "text-warning"}>
                              {money(s.amountFa)} · {s.status === "paid" ? (fa ? "پرداخت‌شده" : "Paid") : s.status === "processing" ? (fa ? "در حال" : "Processing") : (fa ? "در انتظار" : "Pending")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
