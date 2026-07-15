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

function effectivePlan(
  subscription: SubscriptionRow,
  pro: boolean
): SubscriptionPlan {
  return pro ? PRO_PLAN : FREE_PLAN;
}

export async function getSubscriptionStatus(userId: string) {
  const subscription = await getOrCreateSubscription(userId);
  const usage = await getUsageCounts(userId);
  const pro = isProTier(subscription.tier, subscription.stripe_status ?? null);
  const plan = effectivePlan(subscription, pro);

  return {
    tier: subscription.tier,
    isPro: pro,
    canAddMaterials: pro || usage.materials < plan.material_limit,
    canAppendToMaterials: pro,
    canExportQuestions: pro,
    canStartTest: pro || usage.attempts < plan.attempt_limit,
    materialLimit: plan.material_limit,
    attemptLimit: plan.attempt_limit,
    allowReattempt: plan.allow_reattempt,
    allowTimed: plan.allow_timed,
    billingStatus: subscription.stripe_status ?? null,
    currentPeriodEnd: subscription.current_period_end ?? null,
    usage,
    limits: {
      materialsReached: usage.materials >= plan.material_limit,
      attemptsReached: usage.attempts >= plan.attempt_limit,
    },
    plan,
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

async function materialExistsForUser(userId: string, title: string) {
  const { data, error } = await supabaseAdmin
    .from("materials")
    .select("id")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function requireMaterialUploadPermission(
  userId: string,
  options?: { appendToMaterialTitle?: string; materialTitle?: string }
) {
  const status = await getSubscriptionStatus(userId);
  if (status.isPro) {
    return status;
  }

  const explicitAppend = Boolean(options?.appendToMaterialTitle?.trim());
  if (explicitAppend) {
    const error = new Error(
      "Subscribe to Pro to add documents to existing materials."
    );
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }

  const materialTitle = options?.materialTitle?.trim();
  if (materialTitle && (await materialExistsForUser(userId, materialTitle))) {
    const error = new Error(
      "Subscribe to Pro to add documents to existing materials."
    );
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }

  if (status.limits.materialsReached) {
    const error = new Error(
      "Free plan includes 1 document upload. Subscribe to Pro for unlimited uploads."
    );
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }

  return status;
}

export async function requireTestStartPermission(
  userId: string,
  options?: {
    materialId?: string | null;
    materialTitle?: string;
    questionType?: string | null;
    isTimed?: boolean;
  }
) {
  const status = await getSubscriptionStatus(userId);
  const isTimed = options?.isTimed !== false;

  if (isTimed && !status.allowTimed) {
    const error = new Error("Timed tests are a Pro feature.");
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }

  if (status.limits.attemptsReached) {
    const error = new Error(
      status.isPro
        ? "Attempt limit reached for your subscription."
        : "Free plan includes 2 practice tests. Subscribe to Pro for unlimited tests and retakes."
    );
    (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
    throw error;
  }

  if (status.isPro && !status.allowReattempt) {
    let query = supabaseAdmin
      .from("attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (options?.materialId) {
      query = query.eq("material_id", options.materialId);
    } else if (options?.materialTitle) {
      query = query.eq("material_title", options.materialTitle);
    } else {
      return status;
    }

    if (options?.questionType) {
      query = query.eq("question_type", options.questionType);
    } else {
      query = query.is("question_type", null);
    }

    const { count: materialAttempts } = await query;

    if (materialAttempts && materialAttempts > 0) {
      const error = new Error("Retakes are not allowed on your plan.");
      (error as Error & { code: string }).code = "SUBSCRIPTION_REQUIRED";
      throw error;
    }
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
