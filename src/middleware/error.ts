import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HttpError } from "../lib/errors.js";
import { env } from "../config/env.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Zod validation
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: err.flatten(),
      },
    });
    return;
  }

  // Known HTTP errors
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: statusToCode(err.status),
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Prisma
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: { code: "CONFLICT", message: "Resource already exists", details: err.meta },
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
      return;
    }
  }

  // Fallback
  console.error("[error]", err);
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Something went wrong",
      ...(env.NODE_ENV === "development" && err instanceof Error
        ? { stack: err.stack }
        : {}),
    },
  });
};

function statusToCode(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 402: return "SUBSCRIPTION_SUSPENDED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 422: return "UNPROCESSABLE_ENTITY";
    default: return "ERROR";
  }
}
