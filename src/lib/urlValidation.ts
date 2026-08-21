import { z } from "zod";

/**
 * z.string().url() alone accepts anything the WHATWG URL parser considers
 * valid — including `javascript:` and other non-http schemes. Every URL we
 * store here ends up rendered as an <a href>, <img src>, or CSS url() on
 * the public page, so restrict to http(s) explicitly instead of trusting
 * .url() alone.
 */
export const httpUrl = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => /^https?:\/\//i.test(v), { message: "Debe ser un enlace http(s) válido" })
    .refine((v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    }, { message: "URL inválida" });
