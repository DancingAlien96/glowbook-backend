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

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

apiRouter.use("/auth", authRoutes);
apiRouter.use("/salon", salonRoutes);
apiRouter.use("/services", servicesRoutes);
apiRouter.use("/stylists", stylistsRoutes);
apiRouter.use("/clients", clientsRoutes);
apiRouter.use("/appointments", appointmentsRoutes);
apiRouter.use("/schedules", schedulesRoutes);
apiRouter.use("/payments", paymentsRoutes);

// Public (no auth)
apiRouter.use("/public", publicRoutes);
apiRouter.use("/public/payments", publicPaymentsRoutes);
