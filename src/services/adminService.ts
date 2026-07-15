import { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabaseAdmin";
import {
  applyFreeSubscription,
  applyProSubscription,
  getSubscriptionStatus,
} from "./subscriptionService";
import { listUserDevices } from "./deviceSessionService";
import { isProTier } from "./subscriptionPlans";
import { reactivateAccount, deactivateAccount } from "./accountService";
import { countPendingDeletionRequests } from "./deletionRequestService";

type ProfileRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  field_of_study?: string | null;
  occupation?: string | null;
  created_at?: string | null;
  deactivated_at?: string | null;
};

async function getAuthUser(userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error("User not found");
  }
  return data.user;
}

function displayName(profile?: ProfileRow | null) {
  const name = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || "Unnamed user";
}

async function enrichUserSummary(profile: ProfileRow, authUser?: User | null) {
  const user = authUser ?? (await getAuthUser(profile.id));
  const subscription = await getSubscriptionStatus(profile.id);

  return {
    id: profile.id,
    email: user.email ?? null,
    name: displayName(profile),
    phoneNumber: profile.phone_number ?? null,
    fieldOfStudy: profile.field_of_study ?? null,
    occupation: profile.occupation ?? null,
    createdAt: user.created_at ?? profile.created_at ?? null,
    deactivatedAt: profile.deactivated_at ?? null,
    isActive: !profile.deactivated_at,
    tier: subscription.tier,
    isPro: subscription.isPro,
    billingStatus: subscription.billingStatus,
    usage: subscription.usage,
  };
}

export async function getPlatformStats() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    { count: totalUsers },
    { count: totalMaterials },
    { count: totalAttempts },
    { count: totalQuestions },
    { data: subscriptions },
    recentProfilesResult,
    pendingDeletionRequests,
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true }),
    supabaseAdmin
      .from("materials")
      .select("*", { count: "exact", head: true }),
    supabaseAdmin
      .from("attempts")
      .select("*", { count: "exact", head: true }),
    supabaseAdmin
      .from("questions")
      .select("*", { count: "exact", head: true }),
    supabaseAdmin.from("subscriptions").select("tier, stripe_status"),
    supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString()),
    countPendingDeletionRequests(),
  ]);

  const proUsers =
    subscriptions?.filter((row) =>
      isProTier(row.tier, row.stripe_status ?? null)
    ).length ?? 0;

  return {
    totalUsers: totalUsers ?? 0,
    proUsers,
    freeUsers: Math.max((totalUsers ?? 0) - proUsers, 0),
    totalMaterials: totalMaterials ?? 0,
    totalAttempts: totalAttempts ?? 0,
    totalQuestions: totalQuestions ?? 0,
    signupsLast7Days: recentProfilesResult.count ?? 0,
    pendingDeletionRequests,
  };
}

async function findAuthUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );
    if (match) {
      return match;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

export async function searchUsers(query: string, page = 1, limit = 20) {
  const normalizedQuery = query.trim();
  const offset = (page - 1) * limit;

  if (normalizedQuery.includes("@")) {
    const authUser = await findAuthUserByEmail(normalizedQuery);

    if (!authUser) {
      return { users: [], total: 0, page, limit };
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, first_name, last_name, phone_number, field_of_study, occupation, created_at, deactivated_at"
      )
      .eq("id", authUser.id)
      .maybeSingle();

    const user = await enrichUserSummary(
      profile ?? { id: authUser.id },
      authUser
    );

    return { users: [user], total: 1, page, limit };
  }

  let profileQuery = supabaseAdmin
    .from("profiles")
    .select(
      "id, first_name, last_name, phone_number, field_of_study, occupation, created_at, deactivated_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (normalizedQuery) {
    profileQuery = profileQuery.or(
      `first_name.ilike.%${normalizedQuery}%,last_name.ilike.%${normalizedQuery}%,phone_number.ilike.%${normalizedQuery}%`
    );
  }

  const { data: profiles, count, error } = await profileQuery;
  if (error) {
    throw new Error(error.message);
  }

  const users = await Promise.all(
    (profiles ?? []).map((profile) => enrichUserSummary(profile as ProfileRow))
  );

  return {
    users,
    total: count ?? users.length,
    page,
    limit,
  };
}

export async function getUserDetail(userId: string) {
  const [authUser, profileResult, subscription, devices] = await Promise.all([
    getAuthUser(userId),
    supabaseAdmin
      .from("profiles")
      .select(
        "id, first_name, last_name, phone_number, field_of_study, occupation, created_at, deactivated_at"
      )
      .eq("id", userId)
      .maybeSingle(),
    getSubscriptionStatus(userId),
    listUserDevices(userId),
  ]);

  return {
    id: userId,
    email: authUser.email ?? null,
    name: displayName(profileResult.data as ProfileRow | null),
    phoneNumber: profileResult.data?.phone_number ?? null,
    fieldOfStudy: profileResult.data?.field_of_study ?? null,
    occupation: profileResult.data?.occupation ?? null,
    createdAt: authUser.created_at ?? profileResult.data?.created_at ?? null,
    deactivatedAt: profileResult.data?.deactivated_at ?? null,
    isActive: !profileResult.data?.deactivated_at,
    lastSignInAt: authUser.last_sign_in_at ?? null,
    subscription,
    devices,
  };
}

export async function reactivateUserAccount(userId: string) {
  await getAuthUser(userId);
  await reactivateAccount(userId);
  return getUserDetail(userId);
}

export async function deactivateUserAccount(userId: string) {
  await getAuthUser(userId);
  await deactivateAccount(userId);
  return getUserDetail(userId);
}

export async function overrideUserSubscription(
  userId: string,
  tier: "PRO" | "FREE"
) {
  if (tier === "PRO") {
    await applyProSubscription(
      userId,
      `admin-${userId}`,
      `admin-${Date.now()}`,
      "active",
      null
    );
  } else {
    await applyFreeSubscription(userId);
  }

  return getSubscriptionStatus(userId);
}

export async function clearUserDevices(userId: string) {
  const { error } = await supabaseAdmin
    .from("user_device_sessions")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return { cleared: true };
}

export async function removeUserDevice(userId: string, deviceId: string) {
  const { error } = await supabaseAdmin
    .from("user_device_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId);

  if (error) {
    throw new Error(error.message);
  }

  return { removed: true };
}

type MaterialRow = {
  id: string;
  title: string;
  source_file?: string | null;
  question_count?: number | null;
  created_at?: string | null;
  user_id: string;
};

async function getProfileMap(userIds: string[]) {
  if (!userIds.length) return new Map<string, ProfileRow>();

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, first_name, last_name, phone_number, field_of_study, occupation, created_at"
    )
    .in("id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile as ProfileRow]));
}

async function getEmailMap(userIds: string[]) {
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const user = await getAuthUser(userId);
        return [userId, user.email ?? null] as const;
      } catch {
        return [userId, null] as const;
      }
    })
  );

  return new Map(entries);
}

function summarizeAttempts(
  attempts: Array<{
    score?: number | null;
    accuracy?: number | null;
    completed_at?: string | null;
  }>
) {
  const completed = attempts.filter((attempt) => attempt.completed_at);
  const totalAttempts = attempts.length;
  const completedAttempts = completed.length;
  const averageAccuracy =
    completedAttempts > 0
      ? Number(
          (
            completed.reduce((sum, attempt) => sum + (attempt.accuracy ?? 0), 0) /
            completedAttempts
          ).toFixed(2)
        )
      : null;
  const bestScore =
    completedAttempts > 0
      ? Math.max(...completed.map((attempt) => attempt.score ?? 0))
      : null;

  return { totalAttempts, completedAttempts, averageAccuracy, bestScore };
}

export async function listMaterials(query = "", page = 1, limit = 20) {
  const normalizedQuery = query.trim();
  const offset = (page - 1) * limit;

  let materialQuery = supabaseAdmin
    .from("materials")
    .select(
      "id, title, source_file, question_count, created_at, user_id",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (normalizedQuery) {
    materialQuery = materialQuery.ilike("title", `%${normalizedQuery}%`);
  }

  const { data: materials, count, error } = await materialQuery;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (materials ?? []) as MaterialRow[];
  const userIds = [...new Set(rows.map((material) => material.user_id))];
  const [profileMap, emailMap] = await Promise.all([
    getProfileMap(userIds),
    getEmailMap(userIds),
  ]);

  const materialIds = rows.map((material) => material.id);
  const { data: attempts } = materialIds.length
    ? await supabaseAdmin
        .from("attempts")
        .select("material_id, score, accuracy, completed_at")
        .in("material_id", materialIds)
    : { data: [] };

  const attemptsByMaterial = new Map<string, typeof attempts>();
  for (const attempt of attempts ?? []) {
    if (!attempt.material_id) continue;
    const current = attemptsByMaterial.get(attempt.material_id) ?? [];
    current.push(attempt);
    attemptsByMaterial.set(attempt.material_id, current);
  }

  const items = rows.map((material) => {
    const profile = profileMap.get(material.user_id);
    const materialAttempts = attemptsByMaterial.get(material.id) ?? [];
    const attemptStats = summarizeAttempts(materialAttempts);

    return {
      id: material.id,
      title: material.title,
      sourceFile: material.source_file ?? null,
      questionCount: material.question_count ?? 0,
      createdAt: material.created_at ?? null,
      uploader: {
        id: material.user_id,
        name: displayName(profile),
        email: emailMap.get(material.user_id) ?? null,
      },
      attempts: attemptStats,
    };
  });

  return {
    materials: items,
    total: count ?? items.length,
    page,
    limit,
  };
}

const ATTEMPT_DETAIL_SELECT =
  "id, user_id, score, max_score, accuracy, completed_at, created_at, is_timed, question_type, time_used_seconds";

async function getAttemptsForMaterial(
  materialId: string,
  materialTitle: string,
  userId: string
) {
  const [byMaterialId, byLegacyTitle] = await Promise.all([
    supabaseAdmin
      .from("attempts")
      .select(ATTEMPT_DETAIL_SELECT)
      .eq("material_id", materialId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("attempts")
      .select(ATTEMPT_DETAIL_SELECT)
      .eq("material_title", materialTitle)
      .eq("user_id", userId)
      .is("material_id", null)
      .order("created_at", { ascending: false }),
  ]);

  if (byMaterialId.error) {
    throw new Error(byMaterialId.error.message);
  }
  if (byLegacyTitle.error) {
    throw new Error(byLegacyTitle.error.message);
  }

  const merged = new Map<string, NonNullable<(typeof byMaterialId.data)[number]>>();
  for (const attempt of [...(byMaterialId.data ?? []), ...(byLegacyTitle.data ?? [])]) {
    merged.set(attempt.id, attempt);
  }

  return [...merged.values()].sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() -
      new Date(a.created_at ?? 0).getTime()
  );
}

export async function getMaterialDetail(materialId: string) {
  const { data: material, error } = await supabaseAdmin
    .from("materials")
    .select("id, title, source_file, question_count, created_at, user_id")
    .eq("id", materialId)
    .single();

  if (error || !material) {
    throw new Error("Material not found");
  }

  const materialRow = material as MaterialRow;
  const [profileMap, emailMap, questionsResult, attempts] = await Promise.all([
      getProfileMap([materialRow.user_id]),
      getEmailMap([materialRow.user_id]),
      supabaseAdmin
        .from("questions")
        .select(
          "id, type, question, topic, domain, is_published, created_at, language"
        )
        .eq("creator_id", materialRow.user_id)
        .eq("material_title", materialRow.title)
        .order("created_at", { ascending: true }),
      getAttemptsForMaterial(
        materialRow.id,
        materialRow.title,
        materialRow.user_id
      ),
    ]);

  if (questionsResult.error) {
    throw new Error(questionsResult.error.message);
  }

  const attemptUserIds = [
    ...new Set(attempts.map((attempt) => attempt.user_id)),
  ];
  const [attemptProfileMap, attemptEmailMap] = await Promise.all([
    getProfileMap(attemptUserIds),
    getEmailMap(attemptUserIds),
  ]);

  const profile = profileMap.get(materialRow.user_id);
  const attemptStats = summarizeAttempts(attempts);

  return {
    id: materialRow.id,
    title: materialRow.title,
    sourceFile: materialRow.source_file ?? null,
    questionCount: materialRow.question_count ?? 0,
    createdAt: materialRow.created_at ?? null,
    uploader: {
      id: materialRow.user_id,
      name: displayName(profile),
      email: emailMap.get(materialRow.user_id) ?? null,
    },
    stats: attemptStats,
    questions: (questionsResult.data ?? []).map((question) => ({
      id: question.id,
      type: question.type,
      question: question.question,
      topic: question.topic,
      domain: question.domain,
      language: question.language,
      isPublished: question.is_published,
      createdAt: question.created_at,
    })),
    attempts: attempts.map((attempt) => {
      const attemptProfile = attemptProfileMap.get(attempt.user_id);
      return {
        id: attempt.id,
        userId: attempt.user_id,
        userName: displayName(attemptProfile),
        userEmail: attemptEmailMap.get(attempt.user_id) ?? null,
        score: attempt.score,
        maxScore: attempt.max_score,
        accuracy: attempt.accuracy,
        questionType: attempt.question_type,
        isTimed: attempt.is_timed,
        timeUsedSeconds: attempt.time_used_seconds,
        createdAt: attempt.created_at,
        completedAt: attempt.completed_at,
      };
    }),
  };
}

export async function getAdminLeaderboard(limit = 50) {
  const { data: attempts, error } = await supabaseAdmin
    .from("attempts")
    .select("user_id, score, accuracy")
    .not("completed_at", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  const stats = new Map<
    string,
    {
      bestScore: number;
      totalScore: number;
      attempts: number;
      totalAccuracy: number;
    }
  >();

  for (const attempt of attempts ?? []) {
    const current = stats.get(attempt.user_id) ?? {
      bestScore: 0,
      totalScore: 0,
      attempts: 0,
      totalAccuracy: 0,
    };

    current.bestScore = Math.max(current.bestScore, attempt.score ?? 0);
    current.totalScore += attempt.score ?? 0;
    current.attempts += 1;
    current.totalAccuracy += attempt.accuracy ?? 0;
    stats.set(attempt.user_id, current);
  }

  const userIds = [...stats.keys()];
  if (!userIds.length) {
    return [];
  }

  const [profileMap, emailMap] = await Promise.all([
    getProfileMap(userIds),
    getEmailMap(userIds),
  ]);

  return userIds
    .map((userId) => {
      const userStats = stats.get(userId)!;
      const profile = profileMap.get(userId);

      return {
        userId,
        name: displayName(profile),
        email: emailMap.get(userId) ?? null,
        bestScore: userStats.bestScore,
        totalScore: userStats.totalScore,
        attempts: userStats.attempts,
        averageAccuracy: Number(
          (userStats.totalAccuracy / userStats.attempts).toFixed(2)
        ),
      };
    })
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore || b.averageAccuracy - a.averageAccuracy
    )
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}
