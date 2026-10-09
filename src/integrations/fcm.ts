import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging, Message } from "firebase-admin/messaging";
import { env } from "../config/env";
import { errors } from "../common/errors";
import { logSystem } from "../common/chalk-logger";

const isFirebaseEnabled = () =>
  env.FIREBASE_NOTIFICATION_ENABLED &&
  env.FIREBASE_PROJECT_ID &&
  env.FIREBASE_CLIENT_EMAIL &&
  env.FIREBASE_PRIVATE_KEY;

if (isFirebaseEnabled() && getApps().length === 0) {
  try {
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY!.replaceAll("\\n", "\n"),
      }),
    });
    logSystem("FCM_INIT", "Firebase Admin initialized successfully.");
  } catch (error) {
    logSystem("FCM_INIT_ERROR", String(error));
  }
}

export const sendPush = async (input: {
  token: string;
  title?: string;
  body: string;
  data?: Record<string, string>;
}) => {
  if (!isFirebaseEnabled() || getApps().length === 0) {
    logSystem(
      "FCM_DISABLED",
      "Firebase notifications are disabled or not initialized.",
    );
    throw errors.unavailable(
      "Notification skipped: Firebase is not configured",
    );
  }
  try {
    const message: Message = {
      notification: {
        title: input.title,
        body: input.body,
      },
      data: input.data,
      token: input.token,
      android: {
        priority: "high",
        notification: {
          channelId: "high_importance_channel",
          sound: "default",
          priority: "high",
          visibility: "public",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: input.title,
              body: input.body,
            },
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
        headers: {
          "apns-priority": "10",
        },
      },
    };

    const response = await getMessaging().send(message);
    return { name: response };
  } catch (error: any) {
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered" ||
      error.message?.includes("UNREGISTERED") ||
      error.message?.includes("NOT_FOUND")
    ) {
      throw errors.badRequest("INVALID_FCM_TOKEN");
    }
    throw errors.unavailable(`Firebase push delivery failed: ${error.message || String(error)}`);
  }
};

