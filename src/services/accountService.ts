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
