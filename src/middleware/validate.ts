import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";

type Source = "body" | "query" | "params";

export const validate =
  (schema: ZodSchema, source: Source = "body"): RequestHandler =>
  (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      next(parsed.error);
      return;
    }
    // Replace with parsed (coerced) value
    (req as unknown as Record<Source, unknown>)[source] = parsed.data;
    next();
  };
