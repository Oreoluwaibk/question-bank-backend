import { Router, Request, Response } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import {
  clearUserDevices,
  deactivateUserAccount,
  getAdminLeaderboard,
  getMaterialDetail,
  getPlatformStats,
  getUserDetail,
  listMaterials,
  overrideUserSubscription,
  reactivateUserAccount,
  removeUserDevice,
  searchUsers,
} from "../services/adminService";

const router = Router();

router.use(requireAdmin);

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getPlatformStats();
    res.json(stats);
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load stats",
    });
  }
});

router.get("/materials", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const result = await listMaterials(query, page, limit);
    res.json(result);
  } catch (error) {
    console.error("Admin materials list error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to load materials",
    });
  }
});

router.get("/materials/:id", async (req: Request, res: Response) => {
  try {
    const material = await getMaterialDetail(req.params.id);
    res.json(material);
  } catch (error) {
    console.error("Admin material detail error:", error);
    res.status(404).json({
      error: error instanceof Error ? error.message : "Material not found",
    });
  }
});

router.get("/leaderboard", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const leaderboard = await getAdminLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    console.error("Admin leaderboard error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to load leaderboard",
    });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const result = await searchUsers(query, page, limit);
    res.json(result);
  } catch (error) {
    console.error("Admin user search error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to search users",
    });
  }
});

router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserDetail(req.params.id);
    res.json(user);
  } catch (error) {
    console.error("Admin user detail error:", error);
    res.status(404).json({
      error: error instanceof Error ? error.message : "User not found",
    });
  }
});

router.patch("/users/:id/reactivate", async (req: Request, res: Response) => {
  try {
    const user = await reactivateUserAccount(req.params.id);
    res.json({ message: "Account reactivated", user });
  } catch (error) {
    console.error("Admin reactivate user error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to reactivate user",
    });
  }
});

router.patch("/users/:id/deactivate", async (req: Request, res: Response) => {
  try {
    const user = await deactivateUserAccount(req.params.id);
    res.json({ message: "Account deactivated", user });
  } catch (error) {
    console.error("Admin deactivate user error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to deactivate user",
    });
  }
});

router.patch("/users/:id/subscription", async (req: Request, res: Response) => {
  try {
    const tier = req.body?.tier;
    if (tier !== "PRO" && tier !== "FREE") {
      return res.status(400).json({ error: 'tier must be "PRO" or "FREE"' });
    }

    const subscription = await overrideUserSubscription(req.params.id, tier);
    res.json({ message: `Subscription set to ${tier}`, subscription });
  } catch (error) {
    console.error("Admin subscription override error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to update subscription",
    });
  }
});

router.delete("/users/:id/devices", async (req: Request, res: Response) => {
  try {
    const result = await clearUserDevices(req.params.id);
    res.json({ message: "All device sessions cleared", ...result });
  } catch (error) {
    console.error("Admin clear devices error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to clear devices",
    });
  }
});

router.delete(
  "/users/:id/devices/:deviceId",
  async (req: Request, res: Response) => {
    try {
      const result = await removeUserDevice(
        req.params.id,
        req.params.deviceId
      );
      res.json({ message: "Device session removed", ...result });
    } catch (error) {
      console.error("Admin remove device error:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to remove device",
      });
    }
  }
);

export default router;
