import { Router, Request, Response } from "express";
import {
  checkAppVersion,
  getAppVersionConfig,
  parseAppPlatform,
} from "../services/appVersionService";
import { isValidVersion } from "../lib/semver";

const router = Router();

router.get("/check", async (req: Request, res: Response) => {
  const platform = parseAppPlatform(
    typeof req.query.platform === "string" ? req.query.platform : undefined
  );
  const currentVersion =
    typeof req.query.version === "string" ? req.query.version.trim() : "";

  if (!platform) {
    return res.status(400).json({
      error: 'platform must be "ios", "android", or "web"',
    });
  }

  if (!currentVersion || !isValidVersion(currentVersion)) {
    return res.status(400).json({
      error: "version is required and must be in semver format, e.g. 1.0.0",
    });
  }

  try {
    const config = await getAppVersionConfig();
    const result = checkAppVersion(config, currentVersion, platform);
    res.json(result);
  } catch (error) {
    console.error("App version check error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to check app version",
    });
  }
});

export default router;
