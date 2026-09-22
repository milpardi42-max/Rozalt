/**
 * Rosie Atelier — Digital Commerce domain types (فاز ۱ تا ۵).
 *
 * All new commerce features (master files, payments, licenses, royalties,
 * discounts, subscriptions) live in this namespace so the existing content,
 * orders and user stores stay untouched.
 */

/* ── Phase 1: private master files ─────────────────────────────── */

export type MasterStatus = "pending" | "approved" | "rejected";

export interface VirusScanResult {
  status: "clean" | "infected" | "error" | "skipped";
  /** "clamd" when CLAMAV_HOST answered, otherwise "builtin" heuristics */
  engine: string;
  detail?: string;
  at: string;
}

export interface SeamlessReport {
  /** 0..1 — higher = edges match better when tiled */
  score: number;
  seamless: boolean;
  threshold: number;
  at: string;
}

export interface MasterFile {
  id: string;
  /** Owning artist (null = platform/admin uploaded) */
  artistId: string | null;
  uploadedBy: string;
  title: string;
  description?: string;
  originalName: string;
  ext: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /** Private path relative to cwd — NEVER under /public */
  storagePath: string;
  /** Auto-generated watermarked preview (images only) */
  previewPath?: string;
  /** Auto-generated mockup renders (Phase 3) */
  mockupPaths?: string[];
  /** Linked catalog pattern — where this master is sold from */
  patternId?: string;
  status: MasterStatus;
  reviewNote?: string;
  reviewedAt?: string;
  virusScan: VirusScanResult;
  analysis?: SeamlessReport;
  /** Exclusive sale completed — file locked & pattern delisted */
  soldExclusive?: boolean;
  downloadCount: number;
  createdAt: string;
}

/* ── Phase 1/4: payments ───────────────────────────────────────── */

export type PaymentProvider = "zarinpal" | "stripe";
export type PaymentStatus = "created" | "paid" | "failed" | "expired";

export interface Payment {
  id: string;
  /** ZarinPal authority (A…) or Stripe session id (cs_…) */
  authority: string;
  purchaseId: string;
  provider: PaymentProvider;
  /** Toman (fa) — ZarinPal charges rial (= toman × 10) */
  amountFa: number;
  /** USD cents — Stripe */
  amountUsdCents: number;
  status: PaymentStatus;
  refId?: string;
  createdAt: string;
  paidAt?: string;
}

export type LicenseType = "personal" | "commercial" | "extended" | "exclusive" | "subscription";

export interface PurchaseLine {
  kind: "pattern" | "product" | "subscription";
  id: string;
  sku: string;
  title: string;
  image: string;
  /** Unit price as charged (already licence-multiplied for patterns) */
  price: { fa: number; en: number };
  qty: number;
  /** Resolved for pattern lines */
  license?: Exclude<LicenseType, "subscription">;
  exclusive?: boolean;
  /** Artist royalty attribution (pattern.artistId) */
  artistId?: string;
  /** Backup snapshot when an exclusive sale delists the pattern */
  patternBackup?: unknown;
}

export type PurchaseStatus = "pending_payment" | "paid" | "cancelled" | "failed";

export interface Purchase {
  id: string;
  userId?: string;
  email: string;
  name: string;
  lines: PurchaseLine[];
  total: { fa: number; en: number };
  status: PurchaseStatus;
  discountCode?: string;
  discountAmountFa?: number;
  affiliateCode?: string;
  /** "fa" | "en" — locale to redirect back to after the gateway */
  locale?: string;
  createdAt: string;
  paidAt?: string;
}

/* ── Phase 2: licenses & certificates ──────────────────────────── */

export interface License {
  id: string;
  purchaseId: string;
  masterId: string;
  patternId?: string;
  type: LicenseType;
  holderName: string;
  holderEmail: string;
  /** Public verifiable code, e.g. RA-8F3A… */
  certificateNo: string;
  /** Set when issued against a subscription quota */
  subscriptionId?: string;
  downloadUrlTtlSec?: number;
  issuedAt: string;
}

/* ── Phase 3: royalty & settlement ─────────────────────────────── */

export interface RoyaltyEntry {
  id: string;
  kind: "sale" | "affiliate" | "subscription";
  purchaseId: string;
  licenseId?: string;
  artistId: string;
  /** Toman */
  amountFa: number;
  /** Share percent applied (for audit) */
  pct: number;
  settlementId?: string;
  createdAt: string;
}

export interface Settlement {
  id: string;
  artistId: string;
  /** Toman */
  amountFa: number;
  entryIds: string[];
  status: "pending" | "processing" | "paid";
  note?: string;
  createdAt: string;
  paidAt?: string;
}

/* ── Phase 5: discounts / affiliate ────────────────────────────── */

export type DiscountKind = "percent" | "fixed" | "affiliate";

export interface DiscountCode {
  code: string;
  kind: DiscountKind;
  /** percent (0-100) or fixed toman, or affiliate commission percent */
  value: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  active: boolean;
  /** Artist receiving affiliate commission / attribution */
  artistId?: string;
  note?: string;
  createdAt: string;
}

/* ── Phase 5: subscription ─────────────────────────────────────── */

export interface SubscriptionPlan {
  id: string;
  title: { fa: string; en: string };
  price: { fa: number; en: number };
  days: number;
  /** -1 = unlimited standard downloads */
  downloadsIncluded: number;
}

export interface Subscriber {
  id: string;
  planId: string;
  userId?: string;
  email: string;
  startedAt: string;
  expiresAt: string;
  downloadsUsed: number;
  status: "active" | "expired" | "cancelled";
}

/* ── Phase 4: presigned multipart (>200 MB) ────────────────────── */

export interface MultipartUpload {
  id: string;
  uploadedBy: string;
  artistId: string | null;
  fileName: string;
  title: string;
  description?: string;
  patternId?: string;
  sizeBytes: number;
  partSize: number;
  partCount: number;
  receivedParts: number[];
  tmpDir: string;
  createdAt: string;
}

/* ── outbox (Phase 4 delivery e-mail, always persisted) ────────── */

export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  /** Paths of licenses/downloads included in the mail */
  links: string[];
  sentVia: "resend" | "outbox";
  createdAt: string;
}

/* ── persisted document ────────────────────────────────────────── */

export interface CommerceDB {
  masters: MasterFile[];
  payments: Payment[];
  purchases: Purchase[];
  licenses: License[];
  royalties: RoyaltyEntry[];
  settlements: Settlement[];
  discounts: DiscountCode[];
  subscribers: Subscriber[];
  uploads: MultipartUpload[];
  outbox: OutboxEmail[];
}

export const EMPTY_DB: CommerceDB = {
  masters: [],
  payments: [],
  purchases: [],
  licenses: [],
  royalties: [],
  settlements: [],
  discounts: [],
  subscribers: [],
  uploads: [],
  outbox: [],
};
