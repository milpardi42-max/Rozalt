/** Shared absolute-origin helper for links written into e-mails / callbacks. */
export function absoluteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Origin of the *incoming request* — preferred for gateway redirects so the
 * preview proxy host (and any custom domain) is honoured even when
 * NEXT_PUBLIC_SITE_URL still points at localhost.
 */
export function originFromRequest(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const host = fwdHost ?? req.headers.get("host");
  if (host) {
    const fwdProto = req.headers.get("x-forwarded-proto");
    const proto = fwdProto ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host.split(",")[0].trim()}`;
  }
  return absoluteOrigin();
}
