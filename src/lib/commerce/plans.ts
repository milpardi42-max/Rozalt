import type { SubscriptionPlan } from "./types";

/** Phase 5 — downloadable-catalog subscription plans (Toman / USD). */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "monthly-std",
    title: { fa: "اشتراک ماهانه — دانلود استاندارد", en: "Monthly — Standard downloads" },
    price: { fa: 890_000, en: 22 },
    days: 30,
    downloadsIncluded: 30,
  },
  {
    id: "monthly-pro",
    title: { fa: "اشتراک ماهانه — پرو (نامحدود)", en: "Monthly — Pro (unlimited)" },
    price: { fa: 1_990_000, en: 49 },
    days: 30,
    downloadsIncluded: -1,
  },
  {
    id: "yearly-std",
    title: { fa: "اشتراک سالانه — استاندارد", en: "Yearly — Standard" },
    price: { fa: 8_900_000, en: 219 },
    days: 365,
    downloadsIncluded: 360,
  },
];

export function planById(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}
