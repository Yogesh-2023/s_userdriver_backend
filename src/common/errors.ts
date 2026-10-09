export class AppError extends Error {
  public readonly isAppError = true;
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) =>
    new AppError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "Authentication required") =>
    new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "Access denied") =>
    new AppError(403, "FORBIDDEN", message),
  notFound: (message: string) => new AppError(404, "NOT_FOUND", message),
  conflict: (message: string) => new AppError(409, "CONFLICT", message),
  rateLimited: (message: string, details?: unknown) =>
    new AppError(429, "RATE_LIMITED", message, details),
  unavailable: (message: string) =>
    new AppError(503, "SERVICE_UNAVAILABLE", message),
};
