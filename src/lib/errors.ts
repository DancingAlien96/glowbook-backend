export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const BadRequest = (msg = "Bad request", details?: unknown) => new HttpError(400, msg, details);
export const Unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
export const PaymentRequired = (msg = "Payment required") => new HttpError(402, msg);
export const Forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const NotFound = (msg = "Not found") => new HttpError(404, msg);
export const Conflict = (msg = "Conflict") => new HttpError(409, msg);
export const UnprocessableEntity = (msg = "Unprocessable entity", details?: unknown) => new HttpError(422, msg, details);
