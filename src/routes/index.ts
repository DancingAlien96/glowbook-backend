import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { salonRoutes } from "../modules/salon/salon.controller.js";
import { servicesRoutes } from "../modules/services/services.controller.js";
import { stylistsRoutes } from "../modules/stylists/stylists.controller.js";
import { clientsRoutes } from "../modules/clients/clients.controller.js";
import { appointmentsRoutes } from "../modules/appointments/appointments.controller.js";
import { schedulesRoutes } from "../modules/schedules/schedules.controller.js";
import { paymentsRoutes, publicPaymentsRoutes } from "../modules/payments/payments.controller.js";
import { publicRoutes } from "../modules/public/public.controller.js";
import { staffRoutes } from "../modules/staff/staff.controller.js";
import { meRoutes } from "../modules/me/me.controller.js";
import { subscriptionRoutes } from "../modules/subscription/subscription.controller.js";
import { adminRoutes } from "../modules/admin/admin.controller.js";
import { pushRoutes } from "../modules/push/push.controller.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

apiRouter.use("/auth", authRoutes);

// Owner area — multi-tenant CRUD scoped to req.salonId
apiRouter.use("/salon", salonRoutes);
apiRouter.use("/services", servicesRoutes);
apiRouter.use("/stylists", stylistsRoutes);
apiRouter.use("/clients", clientsRoutes);
apiRouter.use("/appointments", appointmentsRoutes);
apiRouter.use("/schedules", schedulesRoutes);
apiRouter.use("/payments", paymentsRoutes);
apiRouter.use("/staff", staffRoutes);

// Stylist portal — restricted to req.stylistId
apiRouter.use("/me", meRoutes);

// Owner self-billing — subscription status, history, upload receipts to the platform
apiRouter.use("/subscription", subscriptionRoutes);

// Super-admin (platform owner) — list salons, approve/reject subscription payments, settings
apiRouter.use("/admin", adminRoutes);

// Web Push — VAPID public key (open), subscribe/unsubscribe (authenticated)
apiRouter.use("/push", pushRoutes);

// Public (no auth)
apiRouter.use("/public", publicRoutes);
apiRouter.use("/public/payments", publicPaymentsRoutes);
