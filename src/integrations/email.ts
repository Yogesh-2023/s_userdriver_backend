import { env } from "../config/env";
import { errors } from "../common/errors";

export const sendEmail = async (input: {
  to: string;
  subject?: string;
  body: string;
}) => {
  if (!env.EMAIL_WEBHOOK_URL || !env.EMAIL_FROM) {
    throw errors.unavailable("Email provider is not configured");
  }
  const response = await fetch(env.EMAIL_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.EMAIL_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${env.EMAIL_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.body,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw errors.unavailable("Email delivery failed");
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    messageId?: string;
  };
  return { providerId: payload.messageId ?? payload.id };
};
