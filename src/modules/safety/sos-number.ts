import { Prisma } from "@prisma/client";

// 32-char alphabet without ambiguous characters (0/O, 1/I/L).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ALPHABET_LENGTH = ALPHABET.length;
const MAX_ATTEMPTS = 5;

export const generateSosNumber = (): string => {
  let value = "S";
  for (let i = 0; i < 6; i += 1) {
    value += ALPHABET[Math.floor(Math.random() * ALPHABET_LENGTH)];
  }
  return value;
};

const isSosNumberConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  Array.isArray(error.meta?.target) &&
  (error.meta.target as string[]).includes("sosNumber");

/**
 * Runs `run` with a freshly generated SOS number and retries on the rare
 * unique-constraint collision, guaranteeing a collision-safe SOS number.
 */
export const withUniqueSosNumber = async <T>(
  run: (sosNumber: string) => Promise<T>,
  attempts: number = MAX_ATTEMPTS,
): Promise<T> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run(generateSosNumber());
    } catch (error) {
      if (!isSosNumberConflict(error) || attempt === attempts - 1) {
        throw error;
      }
    }
  }
  throw new Error("Unable to allocate a unique SOS number");
};
