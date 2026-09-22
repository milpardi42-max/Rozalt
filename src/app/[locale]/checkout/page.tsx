import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutView } from "@/components/product/CheckoutView";
import { dictionaries } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: dictionaries[locale].common.checkout };
}
export default function CheckoutPage() {
  /* Suspense boundary required for useSearchParams (gateway return flags) */
  return (
    <Suspense fallback={<div className="container-x pt-40 pb-20" />}>
      <CheckoutView />
    </Suspense>
  );
}
