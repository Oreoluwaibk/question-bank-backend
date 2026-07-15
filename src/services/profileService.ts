import { supabaseAdmin } from "./supabaseAdmin";
import { getPublishedTermsVersion } from "./legalService";

export function profileNamesFromAuthUser(user: {
  user_metadata?: Record<string, unknown>;
  email?: string | null;
}) {
  const meta = user.user_metadata ?? {};
  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";

  const firstFromMeta =
    (typeof meta.first_name === "string" && meta.first_name) ||
    (typeof meta.given_name === "string" && meta.given_name) ||
    "";

  const lastFromMeta =
    (typeof meta.last_name === "string" && meta.last_name) ||
    (typeof meta.family_name === "string" && meta.family_name) ||
    "";

  if (firstFromMeta) {
    return {
      first_name: firstFromMeta.trim(),
      last_name: lastFromMeta.trim() || firstFromMeta.trim(),
    };
  }

  if (fullName.trim()) {
    const parts = fullName.trim().split(/\s+/);
    return {
      first_name: parts[0],
      last_name: parts.slice(1).join(" ") || parts[0],
    };
  }

  const emailPrefix = user.email?.split("@")[0]?.trim();
  const fallback = emailPrefix || "User";

  return {
    first_name: fallback,
    last_name: fallback,
  };
}

export async function getProfileByUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateUserProfile(
  userId: string,
  updates: Record<string, unknown>
) {
  const sanitized = { ...updates };
  delete sanitized.id;

  if (Object.keys(sanitized).length === 0) {
    const existing = await getProfileByUserId(userId);
    if (existing) {
      return existing;
    }
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update(sanitized)
    .eq("id", userId)
    .select("*");

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (updatedRows?.length) {
    return updatedRows[0];
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.getUserById(userId);

  if (authError || !authData.user) {
    throw new Error("Could not load account profile");
  }

  const names = profileNamesFromAuthUser(authData.user);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: userId,
      ...names,
      ...sanitized,
    })
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: retryRows, error: retryError } = await supabaseAdmin
        .from("profiles")
        .update(sanitized)
        .eq("id", userId)
        .select("*");

      if (retryError) {
        throw new Error(retryError.message);
      }

      if (retryRows?.length) {
        return retryRows[0];
      }

      const existing = await getProfileByUserId(userId);
      if (existing) {
        return existing;
      }
    }

    throw new Error(insertError.message);
  }

  return inserted;
}

export async function recordTermsAcceptance(userId: string) {
  const acceptedAt = new Date().toISOString();
  const termsVersion = await getPublishedTermsVersion();

  await updateUserProfile(userId, {
    terms_accepted_at: acceptedAt,
    terms_accepted_version: termsVersion,
  });

  return { acceptedAt, termsVersion };
}
