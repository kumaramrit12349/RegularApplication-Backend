import { Router } from "express";
import { authenticateTokenAndEmail, requireRole } from "../../middlewares/authMiddleware";
import { getUserPlatformStats } from "../../services/private/userService";

const router = Router();
router.use(authenticateTokenAndEmail);

// User stats — Admin only
router.get("/stats", requireRole("admin"), async (req, res) => {
  try {
    const timeRange = (req.query.timeRange as string) || "all";
    const stats = await getUserPlatformStats(timeRange);
    res.json({ success: true, data: stats });
  } catch (err: any) {
    console.error("Failed to get user stats:", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to fetch user stats",
    });
  }
});

export default router;
