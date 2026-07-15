import { supabaseAdmin } from "./supabaseAdmin";

export const SUPPORT_EMAIL = "oreoluwa.creatives@gmail.com";

export const ACCOUNT_DEACTIVATED_MESSAGE = `This account has been deactivated. Contact us at ${SUPPORT_EMAIL} to reactivate.`;

export class AccountDeactivatedError extends Error {
  code = "ACCOUNT_DEACTIVATED";

  constructor() {
    super(ACCOUNT_DEACTIVATED_MESSAGE);
  }
}

export async function getDeactivatedAt(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("deactivated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Allow auth to work before account_deactivation.sql has been applied.
    if (/deactivated_at/i.test(error.message)) {
      return null;
    }
    throw new Error(error.message);
  }

  return data?.deactivated_at ?? null;
}

export async function isAccountActive(userId: string) {
  const deactivatedAt = await getDeactivatedAt(userId);
  return !deactivatedAt;
}

export async function assertAccountActive(userId: string) {
  if (!(await isAccountActive(userId))) {
    throw new AccountDeactivatedError();
  }
}

async function clearAllDeviceSessions(userId: string) {
  const { error } = await supabaseAdmin
    .from("user_device_sessions")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deactivateAccount(userId: string) {
  const deactivatedAt = new Date().toISOString();

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ deactivated_at: deactivatedAt })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message);
  }

  await clearAllDeviceSessions(userId);

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: "876000h" }
  );

  if (banError) {
    throw new Error(banError.message);
  }

  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    userId,
    "global"
  );

  if (signOutError) {
    console.error("Failed to revoke sessions on deactivate:", signOutError);
  }

  return { deactivatedAt };
}

export async function reactivateAccount(userId: string) {
  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ deactivated_at: null })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: "none" }
  );

  if (banError) {
    throw new Error(banError.message);
  }

  return { reactivated: true };
}

export async function deleteAccountPermanently(userId: string) {
  const { data: attempts, error: attemptsError } = await supabaseAdmin
    .from("attempts")
    .select("id")
    .eq("user_id", userId);

  if (attemptsError) {
    throw new Error(attemptsError.message);
  }

  const attemptIds = (attempts ?? []).map((attempt) => attempt.id);

  if (attemptIds.length) {
    const [{ error: answersError }, { error: statsError }] = await Promise.all([
      supabaseAdmin.from("attempt_answers").delete().in("attempt_id", attemptIds),
      supabaseAdmin
        .from("attempt_question_stats")
        .delete()
        .in("attempt_id", attemptIds),
    ]);

    if (answersError) {
      throw new Error(answersError.message);
    }
    if (statsError) {
      throw new Error(statsError.message);
    }
  }

  const tables = [
    supabaseAdmin.from("attempts").delete().eq("user_id", userId),
    supabaseAdmin.from("questions").delete().eq("creator_id", userId),
    supabaseAdmin.from("materials").delete().eq("user_id", userId),
    supabaseAdmin.from("subscriptions").delete().eq("user_id", userId),
    supabaseAdmin.from("user_device_sessions").delete().eq("user_id", userId),
    supabaseAdmin
      .from("account_deletion_requests")
      .delete()
      .eq("user_id", userId),
    supabaseAdmin.from("profiles").delete().eq("id", userId),
  ];

  for (const query of tables) {
    const { error } = await query;
    if (error && !/account_deletion_requests/i.test(error.message)) {
      throw new Error(error.message);
    }
  }

  const { error: deleteUserError } =
    await supabaseAdmin.auth.admin.deleteUser(userId);

  if (deleteUserError) {
    throw new Error(deleteUserError.message);
  }

  return { deleted: true };
}
