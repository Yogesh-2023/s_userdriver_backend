import { Payment, Prisma } from "@prisma/client";
import { errors } from "../../../common/errors";

export const activeSubscriptionWhere = (
  driverId?: string,
  now = new Date(),
) => ({
  ...(driverId ? { driverId } : {}),
  status: "ACTIVE" as const,
  expiryDate: { gt: now },
  OR: [{ remainingTrips: null }, { remainingTrips: { gt: 0 } }],
});

// Serialize purchase/activation for one driver across all API instances.
export async function lockSubscriptionDriver(
  tx: Prisma.TransactionClient,
  driverId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "DriverProfile" WHERE "id" = ${driverId}::uuid FOR UPDATE`;
}

export async function expireSubscriptions(
  tx: Prisma.TransactionClient,
  driverId?: string,
) {
  await tx.driverSubscription.updateMany({
    where: {
      ...(driverId ? { driverId } : {}),
      status: "ACTIVE",
      OR: [{ expiryDate: { lte: new Date() } }, { remainingTrips: { lte: 0 } }],
    },
    data: { status: "EXPIRED" },
  });
}

export async function activatePaidSubscription(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  durationDays: number,
) {
  const subscription = await tx.driverSubscription.findUniqueOrThrow({
    where: { id: subscriptionId },
  });
  if (subscription.status === "ACTIVE") return subscription;
  if (subscription.status !== "PENDING_PAYMENT")
    throw errors.conflict("Subscription cannot be activated");
  if (!Number.isSafeInteger(durationDays) || durationDays < 1) {
    throw errors.conflict("Subscription duration is invalid");
  }
  await expireSubscriptions(tx, subscription.driverId);
  const active = await tx.driverSubscription.findFirst({
    where: activeSubscriptionWhere(subscription.driverId),
  });
  if (active)
    throw errors.conflict("Driver already has an active subscription");
  const startDate = new Date();
  const expiryDate = new Date(startDate);
  // Preserve the existing contract: durationValue is a number of days, not months/weeks.
  expiryDate.setUTCDate(expiryDate.getUTCDate() + durationDays);
  return tx.driverSubscription.update({
    where: { id: subscriptionId },
    data: { status: "ACTIVE", startDate, expiryDate },
  });
}

export function subscriptionPaymentResponse(payment: Payment) {
  return {
    id: payment.id,
    subscriptionId: payment.subscriptionId,
    amount: payment.amount,
    amountPaid: payment.amountPaid,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

// Called only after the one-time STARTED -> COMPLETED trip transition, in its transaction.
export async function consumeSubscriptionTrip(
  tx: Prisma.TransactionClient,
  driverId: string,
  startedAt: Date,
) {
  const subscription = await tx.driverSubscription.findFirst({
    where: {
      driverId,
      status: { in: ["ACTIVE", "EXPIRED"] },
      startDate: { lte: startedAt },
      expiryDate: { gt: startedAt },
      remainingTrips: { gt: 0 },
    },
    orderBy: { startDate: "desc" },
  });
  if (!subscription) return;
  await tx.driverSubscription.updateMany({
    where: { id: subscription.id, remainingTrips: { gt: 0 } },
    data: { remainingTrips: { decrement: 1 } },
  });
  await tx.driverSubscription.updateMany({
    where: { id: subscription.id, status: "ACTIVE", remainingTrips: 0 },
    data: { status: "EXPIRED" },
  });
}
