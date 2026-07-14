export type SubscriptionTier = "FREE" | "PRO";

export type SubscriptionPlan = {
  tier: SubscriptionTier;
  material_limit: number;
  attempt_limit: number;
  allow_reattempt: boolean;
  allow_timed: boolean;
};

export const FREE_PLAN: SubscriptionPlan = {
  tier: "FREE",
  material_limit: 0,
  attempt_limit: 1,
  allow_reattempt: false,
  allow_timed: false,
};

export const PRO_PLAN: SubscriptionPlan = {
  tier: "PRO",
  material_limit: 999,
  attempt_limit: 999,
  allow_reattempt: true,
  allow_timed: true,
};

export function isProTier(
  tier: string | null | undefined,
  billingStatus: string | null | undefined
) {
  if (tier !== "PRO") return false;
  if (!billingStatus) return true;
  return ["active", "trialing", "non-renewing"].includes(billingStatus);
}
