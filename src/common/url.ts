import { env } from "../config/env";
import { FastifyRequest } from "fastify";

export const buildFileUrl = (
  req: FastifyRequest,
  relativePath: string | null | undefined,
): string | null => {
  if (!relativePath) return null;

  // If it's already an absolute URL, return it
  if (
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://")
  ) {
    return relativePath;
  }

  // Remove leading slash if present
  const cleanPath = relativePath.startsWith("/")
    ? relativePath.substring(1)
    : relativePath;

  if (env.NODE_ENV === "production") {
    // In production, we'd typically use a CDN or a specific base URL for uploads
    // Assuming the base URL is the app's base URL for now.
    // If you have a specific CDN URL, you can configure it in env.
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    return `${protocol}://${host}/${cleanPath}`;
  }

  const protocol = req.protocol || "http";
  const host = req.headers.host || "localhost:3000";

  return `${protocol}://${host}/${cleanPath}`;
};
