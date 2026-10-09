import { env } from "../config/env";

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  signed: true,
  path: "/",
  maxAge: env.SESSION_TTL_SECONDS,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});
