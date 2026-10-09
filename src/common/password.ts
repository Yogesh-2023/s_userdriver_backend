import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

const derive = (
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const derivedKey = await derive(
    password,
    salt,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
  );
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
};

export const verifyPassword = async (password: string, encoded: string) => {
  const [algorithm, rawCost, rawBlockSize, rawParallelization, salt, expected] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !rawCost ||
    !rawBlockSize ||
    !rawParallelization ||
    !salt ||
    !expected
  ) {
    return false;
  }
  const cost = Number(rawCost);
  const blockSize = Number(rawBlockSize);
  const parallelization = Number(rawParallelization);
  if (
    cost !== COST ||
    blockSize !== BLOCK_SIZE ||
    parallelization !== PARALLELIZATION
  ) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "base64url");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64url"),
    cost,
    blockSize,
    parallelization,
  );
  return (
    expectedBuffer.length === actual.length &&
    timingSafeEqual(expectedBuffer, actual)
  );
};
