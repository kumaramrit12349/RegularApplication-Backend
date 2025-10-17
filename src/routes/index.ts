import { Router, Request, Response } from "express";
import authRoutes from "./auth";
import notificationRouter from "./notification";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Welcome to Node.js + TypeScript backend 🚀" });
});

router.use("/auth", authRoutes);
router.use("/notification", notificationRouter);

export default router;
