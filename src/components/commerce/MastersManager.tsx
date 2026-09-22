"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Eye,
  FileArchive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

import { SESSION_FETCH } from "@/lib/http";
import { cn } from "@/lib/utils";

/* ── types mirrored from the API ─────────────────────────────── */
interface MasterRow {
  id: string;
  title: string;
  originalName: string;
  sizeBytes: number;
  ext: string;
  status: "pending" | "approved" | "rejected";
  reviewNote?: string;
  patternId?: string;
  artistId: string | null;
  virusScan: { status: string; engine: string; detail?: string; at: string };
  analysis?: { score: number; seamless: boolean; threshold: number };
  mockupPaths?: string[];
  hasPreview: boolean;
  mockupCount: number;
  soldExclusive?: boolean;
  downloadCount: number;
  createdAt: string;
}

interface PatternOption {
  id: string;
  title: { fa: string; en: string };
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Admin → بازبینی فایل‌های ماستر (Phase 1) + واترمارک/تحلیل/موکاپ (Phase 2/3).
 * Approve / reject with note, link to catalog pattern, generate mockups,
 * virus + seamless reports, delete record & private file.
 */
export function MastersManager() {
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mockupFor, setMockupFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  const load = useCallback(async () => {
    setError(false);
    try {
      const [mRes, cRes] = await Promise.all([
        fetch("/api/admin/masters", { ...SESSION_FETCH }),
        fetch("/api/admin/content", { ...SESSION_FETCH }),
      ]);
      if (!mRes.ok) throw new Error();
      const m = (await mRes.json()) as { masters: MasterRow[] };
      setRows(m.masters);
      if (cRes.ok) {
        const c = (await cRes.json()) as { content?: { patterns?: PatternOption[] } };
        const list = c.content?.patterns ?? [];
        setPatterns(list);
      }
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      const note =
        action === "reject"
          ? window.prompt("دلیل رد (اختیاری):") ?? undefined
          : undefined;
      const r = await fetch("/api/admin/masters", {
        ...SESSION_FETCH,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, ...(note ? { note } : {}) }),
      });
      if (!r.ok) throw new Error();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const linkPattern = async (id: string, patternId: string) => {
    setBusyId(id);
    try {
      await fetch("/api/admin/masters", {
        ...SESSION_FETCH,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "approve", patternId }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const genMockups = async (id: string) => {
    setBusyId(id);
    setMockupFor(id);
    try {
      await fetch("/api/admin/masters", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusyId(null);
      setMockupFor(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("فایل ماستر و رکورد آن برای همیشه حذف شود؟")) return;
    setBusyId(id);
    try {
      await fetch(`/api/admin/masters?id=${encodeURIComponent(id)}`, { ...SESSION_FETCH, method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 text-center">
        <p className="text-sm text-error">خطا در بارگذاری صف بازبینی.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>تلاش دوباره</Button>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-h3">فایل‌های ماستر — بازبینی</h2>
          <p className="mt-1 text-caption text-foreground-secondary">
            آپلود خصوصی هنرمندان؛ خارج از دسترس عموم، تا تأیید ادمین. {pendingCount} مورد در انتظار.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-caption font-medium transition",
                filter === f ? "bg-foreground text-background" : "text-foreground-secondary hover:bg-background-secondary",
              )}
            >
              {f === "pending" ? "در انتظار" : f === "approved" ? "تأییدشده" : f === "rejected" ? "ردشده" : "همه"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted">
          موردی در این فیلتر نیست.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((m) => (
            <li key={m.id} className="rounded-xl border border-border bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                {/* thumb */}
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-background-secondary">
                  {m.hasPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/master/file?kind=preview&id=${m.id}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-muted">
                      <FileArchive className="h-7 w-7" />
                    </span>
                  )}
                </div>

                {/* info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{m.title}</p>
                    <Badge tone={m.status === "approved" ? "success" : m.status === "rejected" ? "error" : "warning"}>
                      {m.status === "approved" ? "تأیید" : m.status === "rejected" ? "رد" : "در انتظار"}
                    </Badge>
                    {m.soldExclusive && <Badge tone="accent">فروش انحصاری — قفل‌شده</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-caption text-foreground-secondary" dir="ltr">
                    {m.originalName} · {fmtSize(m.sizeBytes)} · {m.downloadCount} دانلود
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-caption">
                    <span className={cn("inline-flex items-center gap-1", m.virusScan.status === "clean" ? "text-success" : "text-error")}>
                      {m.virusScan.status === "clean" ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                      ویروس‌اسکن: {m.virusScan.engine} — {m.virusScan.status === "clean" ? "سالم" : m.virusScan.status}
                    </span>
                    {m.analysis && (
                      <span className={cn(m.analysis.seamless ? "text-success" : "text-warning")}>
                        بی‌درز: {Math.round(m.analysis.score * 100)}% {m.analysis.seamless ? "(بی‌درز)" : "(نیازمند اصلاح)"}
                      </span>
                    )}
                    {m.mockupCount > 0 && <span className="text-accent">{m.mockupCount} موکاپ</span>}
                  </div>
                  {m.reviewNote && <p className="mt-1 text-caption text-error">دلیل رد: {m.reviewNote}</p>}
                </div>

                {/* actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-border bg-white px-2 text-caption"
                    value={m.patternId ?? ""}
                    onChange={(e) => void linkPattern(m.id, e.target.value)}
                    disabled={busyId === m.id}
                  >
                    <option value="">— اتصال به پترن —</option>
                    {patterns.map((p) => (
                      <option key={p.id} value={p.id}>{p.title.fa}</option>
                    ))}
                  </select>

                  {m.status !== "approved" && (
                    <Button size="sm" variant="accent" disabled={busyId === m.id} onClick={() => void act(m.id, "approve")}>
                      {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                      تأیید
                    </Button>
                  )}
                  {m.status !== "rejected" && (
                    <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => void act(m.id, "reject")}>
                      <XCircle className="h-3.5 w-3.5" />
                      رد
                    </Button>
                  )}
                  {m.hasPreview && (
                    <Button size="sm" variant="ghost" onClick={() => setPreviewId(previewId === m.id ? null : m.id)}>
                      <Eye className="h-3.5 w-3.5" />
                      پیش‌نمایش
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busyId === m.id || m.mockupCount > 0} onClick={() => void genMockups(m.id)}>
                    {mockupFor === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    موکاپ
                  </Button>
                  <Button size="sm" variant="ghost" className="text-error" disabled={busyId === m.id} onClick={() => void remove(m.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* preview drawer */}
              {previewId === m.id && (
                <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3">
                  <span className="relative block h-32 w-48 overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/master/file?kind=preview&id=${m.id}`} alt="" className="h-full w-full object-cover" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">واترمارک‌دار</span>
                  </span>
                  {(m.mockupPaths ?? []).map((_, i) => (
                    <span key={i} className="relative block h-32 w-48 overflow-hidden rounded-lg border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/master/file?kind=mockup&idx=${i}&id=${m.id}`} alt="" className="h-full w-full object-cover" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">موکاپ {i + 1}</span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
