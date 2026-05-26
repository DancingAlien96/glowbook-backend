import { Router } from "express";
import * as c from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export const authRoutes = Router();

authRoutes.post("/register", ...c.register);
authRoutes.post("/login", ...c.login);
authRoutes.post("/refresh", c.refresh);
authRoutes.post("/logout", c.logout);
authRoutes.get("/me", requireAuth, c.me);
