import { Prisma } from "@prisma/client";

// 32-char alphabet without ambiguous characters (0/O, 1/I/L).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ALPHABET_LENGTH = ALPHABET.length;
const MAX_ATTEMPTS = 5;

export const generateTicketNumber = (): string => {
  let value = "#";
  for (let i = 0; i < 6; i += 1) {
    value += ALPHABET[Math.floor(Math.random() * ALPHABET_LENGTH)];
  }
  return value;
};

const isTicketNumberConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  Array.isArray(error.meta?.target) &&
  (error.meta.target as string[]).includes("ticketNumber");

/**
 * Runs `run` with a freshly generated ticket number and retries on the rare
 * unique-constraint collision, guaranteeing a collision-safe ticket number.
 */
export const withUniqueTicketNumber = async <T>(
  run: (ticketNumber: string) => Promise<T>,
  attempts: number = MAX_ATTEMPTS,
): Promise<T> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run(generateTicketNumber());
    } catch (error) {
      if (!isTicketNumberConflict(error) || attempt === attempts - 1) {
        throw error;
      }
    }
  }
  throw new Error("Unable to allocate a unique support ticket number");
};
