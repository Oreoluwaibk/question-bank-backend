import { compareVersions, isValidVersion } from "../lib/semver";
import { supabaseAdmin } from "./supabaseAdmin";

export type AppVersionConfig = {
  latestVersion: string;
  minVersion: string;
  forceUpdate: boolean;
  updateMessage: string | null;
  iosStoreUrl: string | null;
  androidStoreUrl: string | null;
  updatedAt: string;
};

export type AppVersionCheckResult = {
  currentVersion: string;
  latestVersion: string;
  minVersion: string;
  updateAvailable: boolean;
  updateRequired: boolean;
  forceUpdate: boolean;
  message: string | null;
  storeUrl: string | null;
};

type AppVersionRow = {
  latest_version: string;
  min_version: string;
  force_update: boolean;
  update_message: string | null;
  ios_store_url: string | null;
  android_store_url: string | null;
  updated_at: string;
};

const DEFAULT_CONFIG: AppVersionConfig = {
  latestVersion: "1.0.0",
  minVersion: "1.0.0",
  forceUpdate: false,
  updateMessage:
    "A new version of Question Bank is available. Please update to get the latest features and fixes.",
  iosStoreUrl: null,
  androidStoreUrl: null,
  updatedAt: new Date().toISOString(),
};

function mapRow(row: AppVersionRow): AppVersionConfig {
  return {
    latestVersion: row.latest_version,
    minVersion: row.min_version,
    forceUpdate: row.force_update,
    updateMessage: row.update_message,
    iosStoreUrl: row.ios_store_url,
    androidStoreUrl: row.android_store_url,
    updatedAt: row.updated_at,
  };
}

function isMissingAppVersionTableError(message: string) {
  return /app_version_config/i.test(message);
}

async function upsertDefaultConfig(): Promise<AppVersionConfig> {
  const { data, error } = await supabaseAdmin
    .from("app_version_config")
    .upsert(
      {
        id: 1,
        latest_version: DEFAULT_CONFIG.latestVersion,
        min_version: DEFAULT_CONFIG.minVersion,
        force_update: DEFAULT_CONFIG.forceUpdate,
        update_message: DEFAULT_CONFIG.updateMessage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data as AppVersionRow);
}

export async function getAppVersionConfig(): Promise<AppVersionConfig> {
  const { data, error } = await supabaseAdmin
    .from("app_version_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (isMissingAppVersionTableError(error.message)) {
      return DEFAULT_CONFIG;
    }
    throw new Error(error.message);
  }

  if (!data) {
    try {
      return await upsertDefaultConfig();
    } catch (upsertError) {
      if (
        upsertError instanceof Error &&
        isMissingAppVersionTableError(upsertError.message)
      ) {
        return DEFAULT_CONFIG;
      }
      throw upsertError;
    }
  }

  return mapRow(data as AppVersionRow);
}

export type UpdateAppVersionConfigInput = {
  latestVersion: string;
  minVersion: string;
  forceUpdate: boolean;
  updateMessage?: string | null;
  iosStoreUrl?: string | null;
  androidStoreUrl?: string | null;
};

function validateConfigInput(input: UpdateAppVersionConfigInput) {
  if (!isValidVersion(input.latestVersion)) {
    throw new Error("latestVersion must be in semver format, e.g. 1.2.0");
  }
  if (!isValidVersion(input.minVersion)) {
    throw new Error("minVersion must be in semver format, e.g. 1.0.0");
  }
  if (compareVersions(input.minVersion, input.latestVersion) > 0) {
    throw new Error("minVersion cannot be greater than latestVersion");
  }
}

export async function updateAppVersionConfig(
  input: UpdateAppVersionConfigInput
): Promise<AppVersionConfig> {
  validateConfigInput(input);

  const updatedAt = new Date().toISOString();
  const payload = {
    id: 1,
    latest_version: input.latestVersion.trim(),
    min_version: input.minVersion.trim(),
    force_update: input.forceUpdate,
    update_message: input.updateMessage?.trim() || null,
    ios_store_url: input.iosStoreUrl?.trim() || null,
    android_store_url: input.androidStoreUrl?.trim() || null,
    updated_at: updatedAt,
  };

  const { data, error } = await supabaseAdmin
    .from("app_version_config")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data as AppVersionRow);
}

export function checkAppVersion(
  config: AppVersionConfig,
  currentVersion: string,
  platform: "ios" | "android" | "web"
): AppVersionCheckResult {
  const belowMin = compareVersions(currentVersion, config.minVersion) < 0;
  const belowLatest = compareVersions(currentVersion, config.latestVersion) < 0;
  const updateRequired = belowMin;
  const storeUrl =
    platform === "ios"
      ? config.iosStoreUrl
      : platform === "android"
        ? config.androidStoreUrl
        : config.androidStoreUrl ?? config.iosStoreUrl;

  return {
    currentVersion,
    latestVersion: config.latestVersion,
    minVersion: config.minVersion,
    updateAvailable: belowLatest,
    updateRequired,
    forceUpdate: config.forceUpdate && belowLatest,
    message: config.updateMessage,
    storeUrl,
  };
}

export function parseAppPlatform(
  value: string | undefined
): "ios" | "android" | "web" | null {
  if (value === "ios" || value === "android" || value === "web") {
    return value;
  }
  return null;
}
