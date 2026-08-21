import { z } from "zod";
import { httpUrl } from "../../lib/urlValidation.js";

export const serviceCreateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(64).optional().nullable(),
  durationMin: z.coerce.number().int().min(5).max(720),
  priceCents: z.coerce.number().int().min(0),
  active: z.coerce.boolean().optional(),
  stylistIds: z.array(z.string().cuid()).optional(),
  imageUrl: httpUrl(500).optional().nullable(),
});
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;

export const serviceUpdateSchema = serviceCreateSchema.partial();
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;
