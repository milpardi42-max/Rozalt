import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/types";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

function isOwnerEmail(email: string): boolean {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;
  return email.toLowerCase() === ownerEmail;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /* -------- مسیرهای پنل ادمین (/admin/[locale]/) -------- */
  // این مسیرها از layout سایت جدا هستند
  const adminMatch = pathname.match(/^\/admin\/([^/]+)(\/.*)?$/);
  if (adminMatch) {
    const rest = adminMatch[2] ?? "";

    // صفحه لاگین ادمین نیازی به بررسی نشست ندارد
    if (rest === "/login" || rest === "/login/") return NextResponse.next();

    // بقیه مسیرهای ادمین نیاز به نقش admin دارند
    const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await readSessionToken(sessionToken);
    if (!session || session.role !== "admin") {
      const locale = adminMatch[1];
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = `/admin/${locale}/login`;
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  /* -------- میان‌بر پنل ادمین: /{locale}/admin → /admin/{locale} -------- */
  // لینک‌های هدر/فوتر/حساب کاربری به /{locale}/admin اشاره می‌کنند، در حالی که
  // پنل واقعی بیرون از درخت لایوت فروشگاه است. اینجا با یک ریدایرکت واقعی
  // (۳۰۷) هدایت می‌کنیم تا هیچ لینکی به ۴۰۴ نخورد. دسترسی پنل همچنان در
  // بلوک اول همین فایل با نقش admin بررسی می‌شود.
  const siteAdminMatch = pathname.match(/^\/([^/]+)\/admin(?:\/.*)?$/);
  if (siteAdminMatch && (LOCALES as string[]).includes(siteAdminMatch[1])) {
    const adminUrl = req.nextUrl.clone();
    adminUrl.pathname = `/admin/${siteAdminMatch[1]}`;
    return NextResponse.redirect(adminUrl);
  }

  /* -------- i18n locale prefix (برای مسیرهای سایت اصلی) -------- */
  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (!hasLocale) {
    const cookie = req.cookies.get("ra-locale")?.value;
    const locale = LOCALES.includes(cookie as never) ? cookie : DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }

  /* -------- Protected routes (سایت اصلی) -------- */
  const segments = pathname.split("/").filter(Boolean);
  const rest = segments.slice(1).join("/");

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(sessionToken);

  // /[locale]/artist — requires role: artist or admin
  if (rest === "artist" || rest.startsWith("artist/")) {
    if (!session || (session.role !== "artist" && session.role !== "admin")) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = `/${segments[0]}/login`;
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // /[locale]/owner/* — requires owner email or admin role
  if (rest === "owner" || rest.startsWith("owner/")) {
    const isOwnerSession =
      session && (session.role === "admin" || isOwnerEmail(session.email));
    if (!isOwnerSession) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = `/${segments[0]}/login`;
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|fonts|images|favicon.ico|.*\\..*).*)"],
};
