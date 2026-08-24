import { Router } from "express";
import notificationRoutes from "./notification"
import userActivityRoutes from "./userActivity"
import feedbackRoutes from "./feedback"
import scraperAdminRoutes from "./scraperAdmin"
import adminRoleRoutes from "./adminRole"
import eligibilityRoutes from "./eligibility"
import emailTemplateRoutes from "./emailTemplate"
import usersRoutes from "./users"

const router = Router();

router.use("/notification", notificationRoutes);
router.use("/user-activity", userActivityRoutes);
router.use("/feedback", feedbackRoutes);
router.use("/scraper", scraperAdminRoutes);
router.use("/admin-roles", adminRoleRoutes);
router.use("/eligibility", eligibilityRoutes);
router.use("/email-templates", emailTemplateRoutes);
router.use("/users", usersRoutes);

export default router;
