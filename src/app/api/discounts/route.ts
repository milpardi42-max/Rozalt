import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withNoStore } from "@/lib/http";
import { readDb, withDb, newId, nowIso } from "@/lib/commerce/store";
import { SUBSCRIPTION_PLANS, planById } from "@/lib/commerce/plans";
import type { DiscountKind } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

/**
 * GET   /api/discounts — list plans + validate a code (?code=) for checkout UI.
 * POST  /api/discounts — admin: create/update/toggle a discount or affiliate code (Phase 5).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();

  const db = await readDb();

  if (code) {
    const d = db.discounts.find((x) => x.code === code && x.active);
    if (!d) return NextResponse.json({ ok: false, error: "not_found" }, withNoStore());
    const expired = d.expiresAt && new Date(d.expiresAt).getTime() < Date.now();
    const exhausted = d.maxUses > 0 && d.usedCount >= d.maxUses;
    if (expired || exhausted) {
      return NextResponse.json({ ok: false, error: expired ? "expired" : "exhausted" }, withNoStore());
    }
    return NextResponse.json(
      {
        ok: true,
        discount: {
          code: d.code,
          kind: d.kind,
          value: d.value,
          ...(d.artistId ? { artistId: d.artistId } : {}),
        },
      },
      withNoStore(),
    );
  }

  /* public: subscription plans for the pricing UI */
  return NextResponse.json({ ok: true, plans: SUBSCRIPTION_PLANS }, withNoStore());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, withNoStore({ status: 401 }));
  }

  const body = (await req.json().catch(() => null)) as {
    action?: "create" | "toggle" | "delete";
    code?: string;
    kind?: DiscountKind;
    value?: number;
    maxUses?: number;
    expiresAt?: string;
    artistId?: string;
    note?: string;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, withNoStore({ status: 400 }));
  }

  if (body.action === "create") {
    const code = body.code?.trim().toUpperCase();
    if (!code || !body.kind || body.value === undefined) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, withNoStore({ status: 400 }));
    }
    if (body.kind === "percent" && (body.value < 1 || body.value > 100)) {
      return NextResponse.json({ ok: false, error: "percent_range" }, withNoStore({ status: 400 }));
    }
    let created = false;
    await withDb((db) => {
      if (db.discounts.some((d) => d.code === code)) return;
      db.discounts.push({
        code,
        kind: body.kind!,
        value: body.value!,
        maxUses: body.maxUses ?? 0,
        usedCount: 0,
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        active: true,
        ...(body.artistId ? { artistId: body.artistId } : {}),
        ...(body.note ? { note: body.note } : {}),
        createdAt: nowIso(),
      });
      created = true;
    });
    if (!created) {
      return NextResponse.json({ ok: false, error: "already_exists" }, withNoStore({ status: 409 }));
    }
    return NextResponse.json({ ok: true }, withNoStore());
  }

  if (body.action === "toggle" && body.code) {
    await withDb((db) => {
      const d = db.discounts.find((x) => x.code === body.code);
      if (d) d.active = !d.active;
    });
    return NextResponse.json({ ok: true }, withNoStore());
  }

  if (body.action === "delete" && body.code) {
    await withDb((db) => {
      db.discounts = db.discounts.filter((x) => x.code !== body.code);
    });
    return NextResponse.json({ ok: true }, withNoStore());
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, withNoStore({ status: 400 }));
}
