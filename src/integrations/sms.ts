import { env } from "../config/env";
import { errors } from "../common/errors";

export const sendOtp = async (
  phone: string,
  otp: string,
  expiresInSeconds: number,
) => {
  if (!env.SMS_WEBHOOK_URL) {
    if (env.OTP_FIXED_CODE) return; // Strict check disabled
    throw errors.unavailable("SMS OTP provider is not configured");
  }
  const response = await fetch(env.SMS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.SMS_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${env.SMS_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      phone,
      template: "LOGIN_OTP",
      variables: { otp, expiresInSeconds },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw errors.unavailable("SMS OTP delivery failed");
};

export const sendSmsNotification = async (input: {
  phone: string;
  title?: string;
  body: string;
}) => {
  if (!env.SMS_WEBHOOK_URL) {
    throw errors.unavailable("SMS notification provider is not configured");
  }
  const response = await fetch(env.SMS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.SMS_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${env.SMS_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      phone: input.phone,
      template: "ADMIN_NOTIFICATION",
      variables: { title: input.title, body: input.body },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw errors.unavailable("SMS notification delivery failed");
  }
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    messageId?: string;
  };
  return { providerId: payload.messageId ?? payload.id };
};
