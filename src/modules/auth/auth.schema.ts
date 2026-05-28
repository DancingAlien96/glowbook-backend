import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  salonName: z.string().min(2).max(120),
  salonSlug: z
    .string()
    .min(3)
    .max(64)
    .regex(slugRegex, "Slug must be lowercase alphanumeric with hyphens"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "La nueva contraseña debe ser distinta de la actual.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
