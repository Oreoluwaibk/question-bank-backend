import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";

export const MAX_DEVICES_PER_USER = 2;

export class DeviceLimitError extends Error {
  code = "DEVICE_LIMIT_REACHED";

  constructor() {
    super("You cannot login on more than 2 devices at a time");
  }
}

function hashRefreshToken(refreshToken?: string) {
  if (!refreshToken) return null;
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

export async function countUserDevices(userId: string) {
  const { count, error } = await supabaseAdmin
    .from("user_device_sessions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function registerDeviceSession(
  userId: string,
  deviceId: string,
  options?: { deviceName?: string; refreshToken?: string }
) {
  if (!deviceId?.trim()) {
    throw new Error("deviceId is required");
  }

  const normalizedDeviceId = deviceId.trim();
  const refreshTokenHash = hashRefreshToken(options?.refreshToken);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("user_device_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("device_id", normalizedDeviceId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    const deviceCount = await countUserDevices(userId);
    if (deviceCount >= MAX_DEVICES_PER_USER) {
      throw new DeviceLimitError();
    }
  }

  const { error } = await supabaseAdmin.from("user_device_sessions").upsert(
    {
      user_id: userId,
      device_id: normalizedDeviceId,
      device_name: options?.deviceName ?? null,
      refresh_token_hash: refreshTokenHash,
      last_active_at: new Date().toISOString(),
    },
    { onConflict: "user_id,device_id" }
  );

  if (error) {
    if (isDuplicateDeviceSession(error)) {
      return { registered: true, updated: true };
    }
    throw new Error(error.message);
  }

  return { registered: true, updated: Boolean(existing) };
}

function isDuplicateDeviceSession(error: { code?: string; message?: string }) {
  return (
    error.code === "23505" ||
    /user_device_sessions_user_id_device_id_key/i.test(error.message ?? "")
  );
}

export async function removeDeviceSession(userId: string, deviceId: string) {
  if (!deviceId?.trim()) {
    throw new Error("deviceId is required");
  }

  const { error } = await supabaseAdmin
    .from("user_device_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId.trim());

  if (error) {
    throw new Error(error.message);
  }
}

export async function listUserDevices(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_device_sessions")
    .select("id, device_id, device_name, last_active_at, created_at")
    .eq("user_id", userId)
    .order("last_active_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
