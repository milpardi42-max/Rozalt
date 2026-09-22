import "server-only";
import crypto from "crypto";

/**
 * HMAC-signed capability URLs for private master downloads (فاز ۱).
 *
 * Token = base64url(payload) + "." + base64url(HMAC-SHA256(payload))
 * Payload carries license id, master id and expiry. Possession of a valid,
 * unexpired token authorizes exactly one file — same model as S3 presign.
 */

function secret(): string {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "rosie-atelier-dev-secret";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(input: string): Buffer {
  return crypto.createHmac("sha256", secret()).update(input).digest();
}

function timingSafe(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface DownloadClaims {
  /** license id */
  l: string;
  /** master file id */
  m: string;
  /** expiry, unix seconds */
  e: number;
  /** random nonce so two issuances differ */
  n: string;
}

export function signDownload(claims: DownloadClaims): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${b64url(hmac(payload))}`;
}

export function verifyDownload(token: string, nowSec = Math.floor(Date.now() / 1000)): DownloadClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafe(hmac(payload), fromB64url(sig))) return null;
  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as DownloadClaims;
    if (!claims.l || !claims.m || !claims.e) return null;
    if (claims.e < nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Generic short signature for gateway callbacks / part URLs. */
export function signValue(parts: string[]): string {
  return b64url(hmac(parts.join("|")));
}

export function verifyValue(parts: string[], sig: string): boolean {
  return timingSafe(hmac(parts.join("|")), fromB64url(sig));
}

/** Public, non-secret certificate verification code (Phase 2). */
export function certificateNo(licenseId: string): string {
  const h = crypto.createHash("sha256").update(`cert:${licenseId}:${secret()}`).digest("hex");
  return `RA-${h.slice(0, 4).toUpperCase()}-${h.slice(4, 8).toUpperCase()}-${h.slice(8, 12).toUpperCase()}`;
}
