import { supabaseAdmin } from "./supabaseAdmin";
import {
  FREE_PLAN,
  isProTier,
  PRO_PLAN,
  type SubscriptionPlan,
} from "./subscriptionPlans";

type SubscriptionRow = SubscriptionPlan & {
  user_id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_status?: string | null;
  current_period_end?: string | null;
};

export async function provisionFreeSubscription(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        ...FREE_PLAN,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SubscriptionRow;
}

export async function getOrCreateSubscription(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    return data as SubscriptionRow;
  }

  return provisionFreeSubscription(userId);
}

async function getUsageCounts(userId: string) {
  const [{ count: materialCount }, { count: attemptCount }] = await Promise.all([
    supabaseAdmin
      .from("materials")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabaseAdmin
      .from("attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  return {
    materials: materialCount ?? 0,
    attempts: attemptCount ?? 0,
  };
}

export async function getSubscriptionStatus(userId: string) {
  const subscription = await getOrCreateSubscription(userId);
  const usage = await getUsageCounts(userId);
  const pro = isProTier(subscription.tier, subscription.stripe_status ?? null);

  return {
    tier: subscription.tier,
    isPro: pro,
    canAddMaterials: pro,
    canExportQuestions: pro,
    materialLimit: subscription.material_limit,
    attemptLimit: subscription.attempt_limit,
    allowReattempt: subscription.allow_reattempt,
    allowTimed: subscription.allow_timed,
    billingStatus: subscription.stripe_status ?? null,
    currentPeriodEnd: subscription.current_period_end ?? null,
    usage,
    limits: {
      materialsReached: usage.materials >= subscription.material_limit,
      attemptsReached: usage.attempts >= subscription.attempt_limit,
    },
    plan: pro ? PRO_PLAN : FREE_PLAN,
  };
}

export async function requireProSubscription(userId: string) {
  const status = await getSubscriptionStatus(userId);
  if (!status.isPro) {
    const error = new Error("Subscribe to Pro to use this feature");
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }
  return status;
}

export async function applyProSubscription(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripeStatus: string,
  currentPeriodEnd?: Date | null
) {
  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      ...PRO_PLAN,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_status: stripeStatus,
      current_period_end: currentPeriodEnd?.toISOString() ?? null,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function applyFreeSubscription(userId: string) {
  const existing = await getOrCreateSubscription(userId);

  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      ...FREE_PLAN,
      stripe_customer_id: existing.stripe_customer_id ?? null,
      stripe_subscription_id: null,
      stripe_status: "canceled",
      current_period_end: null,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}
