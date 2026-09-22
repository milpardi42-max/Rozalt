import { redirect } from "next/navigation";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/types";

/**
 * The real admin panel lives outside the storefront layout tree, at `/admin/[locale]`.
 * Storefront chrome (header, footer, account page, login page) links to `/{locale}/admin`,
 * so this page forwards straight to the panel instead of dead-ending in a 404.
 * The panel itself is still guarded by middleware — only `role === "admin"` gets through.
 */
export const dynamic = "force-dynamic";

export default async function AdminShortcutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
  redirect(`/admin/${locale}`);
}
