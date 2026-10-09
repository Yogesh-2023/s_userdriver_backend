import type { ZodType } from "zod";
import { errors } from "./errors";

export const parse = <T>(schema: ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw errors.badRequest(
      "Request validation failed",
      result.error.flatten(),
    );
  }
  return result.data;
};
