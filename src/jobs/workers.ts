import { Worker } from "bullmq";
import { env } from "../config/env";
import { prisma } from "../database/prisma";
import { redis } from "../infrastructure/redis";
import { queues, connection } from "../infrastructure/queues";
import { sendPush } from "../integrations/fcm";
import { sendEmail } from "../integrations/email";
import { sendSmsNotification } from "../integrations/sms";
import { DispatchService } from "../modules/dispatch/service";
import { DispatchOfferService } from "../modules/dispatch/dispatch-offer.service";
import { NotificationsService } from "../modules/notifications/service";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
} from "../infrastructure/realtime";
import { expireSubscriptions } from "../modules/driver/services/subscription-state";
import { PaymentsService } from "../modules/payments/service";
import { AdminReportService } from "../modules/admin/services/admin-report.service";
import { DriverAvailabilityService } from "../modules/driver/services/driver-availability.service";
import { SocketPresenceService } from "../realtime/socket-presence.service";
import { redisKeys } from "../realtime/socket.constants";

const dispatch = new DispatchService();
const offerService = new DispatchOfferService();
const notifications = new NotificationsService();
const payments = new PaymentsService();
const reports = new AdminReportService();
const availability = new DriverAvailabilityService();
const presence = new SocketPresenceService();
const workers: Worker[] = [];

export const startWorkers = async () => {
  workers.push(
    new Worker(
      "dispatch",
      async (job) => {
        const bookingId = String(job.data.bookingId);
        if (job.name === "start" || job.name === "dispatch-start") {
          await dispatch.start(bookingId);
          return;
        }
        if (
          job.name === "dispatch-offer-timeout" ||
          job.name === "offer-timeout" ||
          job.name === "batch-timeout"
        ) {
          await offerService.expireAttempt(
            bookingId,
            String(job.data.dispatchCycleId),
            Number(job.data.attemptNumber ?? job.data.batchNo ?? 1),
          );
          return;
        }
        if (job.name === "dispatch-next-batch" || job.name === "next-batch") {
          await offerService.processDispatchCycle(bookingId);
          return;
        }
        if (
          job.name === "dispatch-search-timeout" ||
          job.name === "booking-timeout"
        ) {
          await dispatch.handleBookingTimeout(bookingId);
          return;
        }
        if (job.name === "driver-no-show-check") {
          const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
          });
          if (
            booking?.status === "DRIVER_ASSIGNED" &&
            booking.assignedDriverId
          ) {
            await dispatch.redispatchForDriver(
              bookingId,
              booking.assignedDriverId,
              "DRIVER_NO_SHOW",
            );
          }
          return;
        }
      },
      { connection },
    ),
    new Worker(
      "notifications",
      async (job) => {
        if (job.name === "campaign") {
          await processNotificationCampaign(String(job.data.campaignId));
          return;
        }
        if (job.name !== "deliver") return;
        const notification = await prisma.notification.findUnique({
          where: { id: String(job.data.notificationId) },
          include: {
            user: {
              include: {
                deviceTokens: { where: { isActive: true }, take: 10 },
              },
            },
          },
        });
        if (
          !notification ||
          ["SENT", "DELIVERED", "READ"].includes(notification.status)
        ) {
          return;
        }
        try {
          if (notification.channel === "IN_APP") {
            await prisma.$transaction(async (tx) => {
              await tx.notification.update({
                where: { id: notification.id },
                data: {
                  status: "DELIVERED",
                  sentAt: new Date(),
                  attempts: { increment: 1 },
                },
              });
              if (notification.campaignId) {
                await tx.notificationCampaign.update({
                  where: { id: notification.campaignId },
                  data: {
                    sentCount: { increment: 1 },
                    deliveredCount: { increment: 1 },
                  },
                });
              }
            });
            if (notification.campaignId) {
              await finalizeNotificationCampaign(notification.campaignId);
            }
            return;
          }
          let providerId: string | undefined;
          if (notification.channel === "PUSH") {
            const tokens = notification.user.deviceTokens.map(dt => dt.token);
            if (!tokens.length) throw new Error("No active push token");
            
            const results = await Promise.allSettled(tokens.map(token => 
              sendPush({
                token,
                title: notification.title ?? undefined,
                body: notification.body,
                data: notification.data && typeof notification.data === "object"
                  ? Object.fromEntries(Object.entries(notification.data as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
                  : undefined,
              })
            ));
            
            const invalidTokens: string[] = [];
            const successfulResults: Array<{ name?: string }> = [];
            
            results.forEach((result, idx) => {
              if (result.status === "fulfilled") {
                successfulResults.push(result.value);
              } else if (result.reason?.message === "INVALID_FCM_TOKEN") {
                const tok = tokens[idx];
                if (tok) invalidTokens.push(tok);
              }
            });
            
            if (invalidTokens.length > 0) {
              await notifications.cleanupInvalidTokens(invalidTokens);
            }
            
            if (successfulResults.length === 0) {
              throw new Error("Push delivery failed for all tokens");
            }
            providerId = successfulResults[0]?.name;
          } else if (notification.channel === "SMS") {
            const result = await sendSmsNotification({
              phone: notification.user.phone,
              title: notification.title ?? undefined,
              body: notification.body,
            });
            providerId = result.providerId;
          } else if (notification.channel === "EMAIL") {
            if (!notification.user.email) {
              throw new Error("User has no email address");
            }
            const result = await sendEmail({
              to: notification.user.email,
              subject: notification.title ?? undefined,
              body: notification.body,
            });
            providerId = result.providerId;
          } else {
            throw new Error("Unsupported notification channel");
          }
          await prisma.$transaction(async (tx) => {
            await tx.notification.update({
              where: { id: notification.id },
              data: {
                status: "SENT",
                providerId,
                sentAt: new Date(),
                attempts: { increment: 1 },
              },
            });
            if (notification.campaignId) {
              await tx.notificationCampaign.update({
                where: { id: notification.campaignId },
                data: { sentCount: { increment: 1 } },
              });
            }
          });
          if (notification.campaignId) {
            await finalizeNotificationCampaign(notification.campaignId);
          }
        } catch (error) {
          let isInvalidToken = false;
          if (
            error instanceof Error &&
            error.message === "INVALID_FCM_TOKEN" &&
            notification.channel === "PUSH"
          ) {
            isInvalidToken = true;
            const token = notification.user.deviceTokens[0]?.token;
            if (token) {
              await prisma.deviceToken.updateMany({
                where: { token },
                data: { isActive: false },
              });
            }
          }

          const terminal =
            isInvalidToken || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          await prisma.$transaction(async (tx) => {
            await tx.notification.update({
              where: { id: notification.id },
              data: {
                status: terminal ? "FAILED" : "QUEUED",
                errorCode:
                  error instanceof Error ? error.message : "DELIVERY_ERROR",
                attempts: { increment: 1 },
              },
            });
            if (terminal && notification.campaignId) {
              await tx.notificationCampaign.update({
                where: { id: notification.campaignId },
                data: { failedCount: { increment: 1 } },
              });
            }
          });
          if (terminal && notification.campaignId) {
            await finalizeNotificationCampaign(notification.campaignId);
          }
          if (
            !isInvalidToken &&
            error instanceof Error &&
            error.message !== "Notification skipped: Firebase is not configured"
          ) {
            throw error;
          }
        }
      },
      { connection },
    ),
    new Worker(
      "scheduled-rides",
      async (job) => {
        const bookingId = String(job.data.bookingId);
        const version = Number(job.data.version);
        const scheduled = await prisma.scheduledBooking.findUnique({
          where: { bookingId },
          include: { 
            booking: { 
              include: { 
                customer: true,
                assignedDriver: true
              } 
            } 
          },
        });
        if (!scheduled || !["PENDING", "DRIVER_ASSIGNED", "SEARCHING_DRIVER"].includes(scheduled.booking.status)) return;

        // Version check to prevent stale jobs from firing after reschedule
        if (scheduled.version !== version) return;

        if (["CANCELLED", "TRIP_COMPLETED", "TRIP_STARTED"].includes(scheduled.booking.status)) return;

        const now = new Date();

        const minutesUntilScheduled = (scheduled.scheduledAt.getTime() - now.getTime()) / 60_000;

        if (job.name === "activate") {
          console.log(`[SCHEDULED][ACTIVATE] bookingId=${bookingId} status=${scheduled.booking.status}`);

          if (scheduled.booking.status === "DRIVER_ASSIGNED" && scheduled.booking.assignedDriverId) {
            const availabilityService = new DriverAvailabilityService();
            await availabilityService.markBusy(scheduled.booking.assignedDriverId);
            console.log(`[SCHEDULED][ACTIVATION] Assigned driver ${scheduled.booking.assignedDriverId} set to BUSY for booking ${bookingId}`);
          } else {
            const durationText = scheduled.booking.durationSeconds
              ? `${Math.floor(scheduled.booking.durationSeconds / 3600)} hr ${Math.floor((scheduled.booking.durationSeconds % 3600) / 60)} mins`
              : "";
            const distanceKmText = scheduled.booking.distanceMeters
              ? (scheduled.booking.distanceMeters / 1000).toFixed(1)
              : "";

            console.log(`
========== SCHEDULED RIDE READY ==========

bookingId: ${bookingId}
type: ${scheduled.booking.type}
rideType: ${scheduled.booking.rideType}
scheduledAt: ${scheduled.scheduledAt.toISOString()}
currentUtc: ${now.toISOString()}
minutesUntilScheduled: ${minutesUntilScheduled}
status: ${scheduled.booking.status}
customerId: ${scheduled.booking.customerId}
vehicleCategoryId: ${scheduled.booking.vehicleCategoryId}
pickupAddress: ${scheduled.booking.pickupAddress}
dropAddress: ${scheduled.booking.dropAddress}
estimatedFare: ${scheduled.booking.estimatedFare}
distanceKm: ${distanceKmText}
duration: ${durationText}
assignedDriverId: ${scheduled.booking.assignedDriverId}
assignedVehicleId: ${scheduled.booking.assignedVehicleId}
===========================================
`);

            await queues.dispatch.add(
              "start",
              { bookingId },
              { jobId: `dispatch-${bookingId}-v${version}` },
            );
            setImmediate(() => {
              dispatch.start(bookingId).catch((err) => {
                console.log(`[SCHEDULED][DISPATCH_NOTICE] Direct dispatch error: ${err?.message || err}`);
              });
            });
          }

          await prisma.scheduledBooking.update({
            where: { id: scheduled.id },
            data: {
              activatedAt: now,
              dispatchStartedAt: now,
            },
          });
        } else if (job.name === "reminder") {
          console.log(`[SCHEDULED][REMINDER] bookingId=${bookingId} status=${scheduled.booking.status}`);

          if (scheduled.booking.status === "DRIVER_ASSIGNED" && scheduled.booking.assignedDriver) {
            await notifications.enqueue({
              userId: scheduled.booking.assignedDriver.userId,
              bookingId,
              channel: "PUSH",
              templateKey: "SCHEDULED_RIDE_REMINDER",
              title: "Upcoming Scheduled Ride",
              body: `Your scheduled ride is coming up at ${scheduled.scheduledAt.toLocaleTimeString()}. Please get ready.`,
              data: {
                event: "scheduled-ride:reminder",
                bookingId,
                scheduledAt: scheduled.scheduledAt.toISOString(),
              },
            });
          }

          await prisma.scheduledBooking.update({
            where: { id: scheduled.id },
            data: { reminderSentAt: new Date() },
          });
        }
      },
      { connection },
    ),
    new Worker(
      "maintenance",
      async (job) => {
        if (
          job.name === "persist-locations" ||
          job.name === "trip-location-persist"
        ) {
          await persistLocations();
        }
        if (
          job.name === "recover-bookings" ||
          job.name === "dispatch-recovery" ||
          job.name === "scheduled-ride-recovery"
        ) {
          await recoverPendingBookings();
        }
        if (job.name === "driver-presence-stale-check") {
          await checkDriverPresence(String(job.data.driverId));
        }
        if (job.name === "assigned-driver-disconnect-check") {
          await checkAssignedDriverDisconnect(
            String(job.data.bookingId),
            String(job.data.driverId),
          );
        }
        if (job.name === "trip-tracking-stale-check") {
          await checkTripTracking(String(job.data.tripId));
        }
        if (job.name === "dispatch-assignment-reconciliation") {
          await reconcileRealtimeState();
        }
        if (job.name === "driver-location-stale-check") {
          await reconcileStaleDrivers();
        }
        if (job.name === "invoice-generation") {
          await ensureInvoice(String(job.data.tripId));
        }
        if (job.name === "pickup-waiting-check") {
          await checkPickupWaiting(String(job.data.tripId));
        }
        if (job.name === "otp-cleanup") {
          await prisma.otpVerification.deleteMany({
            where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
          });
        }
      },
      { connection },
    ),
    new Worker(
      "payments",
      async (job) => {
        if (job.name === "process-refund") {
          await payments.processRefund(String(job.data.refundId));
          return;
        }
        if (job.name !== "reconcile") return;
        await expireSubscriptions(prisma);
        const stale = await prisma.payment.findMany({
          where: {
            provider: "RAZORPAY",
            status: { in: ["CREATED", "PENDING", "AUTHORIZED"] },
            createdAt: { lt: new Date(Date.now() - 15 * 60_000) },
          },
          select: { id: true },
          take: 500,
        });
        for (const payment of stale) await payments.reconcile(payment.id);
      },
      { connection },
    ),
    new Worker(
      "reports",
      async (job) => {
        if (job.name === "export") {
          await reports.executeExport(String(job.data.exportId));
        }
      },
      { connection },
    ),
  );

  await Promise.all([
    queues.maintenance.add(
      "persist-locations",
      {},
      {
        jobId: "persist-locations",
        repeat: { every: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
    queues.maintenance.add(
      "otp-cleanup",
      {},
      {
        jobId: "otp-cleanup",
        repeat: { pattern: "0 * * * *" },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
    queues.maintenance.add(
      "recover-bookings",
      {},
      {
        jobId: "recover-bookings",
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
    queues.maintenance.add(
      "dispatch-assignment-reconciliation",
      {},
      {
        jobId: "dispatch-assignment-reconciliation",
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
    queues.maintenance.add(
      "driver-location-stale-check",
      {},
      {
        jobId: "driver-location-stale-check",
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
    queues.payments.add(
      "reconcile",
      {},
      {
        jobId: "payment-reconciliation",
        repeat: { pattern: "*/15 * * * *" },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
  ]);
};

const persistLocations = async () => {
  const entries = await redis.lpop("tracking:persist-buffer", 1_000);
  if (!entries?.length) return;
  const updates = entries.flatMap((entry) => {
    try {
      return [
        JSON.parse(entry) as {
          driverId: string;
          tripId?: string;
          latitude: number;
          longitude: number;
          heading?: number;
          speed?: number;
          accuracy?: number;
          clientTimestamp?: string;
          receivedAt: string;
        },
      ];
    } catch {
      return [];
    }
  });
  await prisma.$transaction(async (tx) => {
    await tx.driverLocation.createMany({
      data: updates.map((item) => ({
        driverId: item.driverId,
        latitude: item.latitude,
        longitude: item.longitude,
        heading: item.heading,
        speed: item.speed,
        accuracy: item.accuracy,
        recordedAt: new Date(item.clientTimestamp ?? item.receivedAt),
      })),
    });
    const trips = updates.filter((item) => item.tripId);
    if (trips.length) {
      await tx.tripLocationHistory.createMany({
        data: trips.map((item) => ({
          tripId: item.tripId!,
          latitude: item.latitude,
          longitude: item.longitude,
          heading: item.heading,
          speed: item.speed,
          recordedAt: new Date(item.clientTimestamp ?? item.receivedAt),
        })),
      });
    }
  });
};

const recoverPendingBookings = async () => {
  const now = new Date();
  const [immediate, scheduled] = await Promise.all([
    prisma.booking.findMany({
      where: { type: "IMMEDIATE", status: "PENDING" },
      select: { id: true },
      take: 500,
    }),
    prisma.scheduledBooking.findMany({
      where: {
        OR: [
          { activationAt: { lte: now } },
          { scheduledAt: { lte: new Date(now.getTime() + 15 * 60_000) } },
        ],
        booking: { status: "PENDING" },
      },
      select: { id: true, bookingId: true, version: true },
      take: 500,
    }),
  ]);
  const minute = Math.floor(now.getTime() / 60_000);
  for (const booking of immediate) {
    await queues.dispatch.add(
      "start",
      { bookingId: booking.id },
      { jobId: `dispatch-recovery-${booking.id}-${minute}` },
    );
  }
  for (const item of scheduled) {
    console.log(`[SCHEDULED][RECOVERY] Recovering pending scheduled booking ${item.bookingId}`);
    await queues.dispatch.add(
      "start",
      { bookingId: item.bookingId },
      {
        jobId: `dispatch-recovery-${item.bookingId}-${item.version}-${minute}`,
      },
    );
    setImmediate(() => {
      dispatch.start(item.bookingId).catch((err) => {
        console.log(`[SCHEDULED][RECOVERY_NOTICE] Direct dispatch error: ${err?.message || err}`);
      });
    });
    await prisma.scheduledBooking.update({
      where: { id: item.id },
      data: {
        activatedAt: now,
        dispatchStartedAt: now,
        recoveryAttemptedAt: now,
        recoveryCount: { increment: 1 },
      },
    });
  }
};

const checkDriverPresence = async (driverId: string) => {
  if (await presence.hasDriverConnections(driverId)) {
    await presence.refreshDriver(driverId);
    return;
  }
  const booking = await prisma.booking.findFirst({
    where: {
      assignedDriverId: driverId,
      status: {
        in: [
          "DRIVER_ASSIGNED",
          "DRIVER_ARRIVING",
          "DRIVER_ARRIVED",
          "TRIP_STARTED",
        ],
      },
    },
    select: { id: true, status: true, trip: { select: { id: true } } },
  });
  if (!booking) {
    console.log(`[DRIVER_PRESENCE] Socket disconnected for driver ${driverId}, retaining ONLINE availability for FCM notifications.`);
    const offers = await prisma.dispatchOffer.findMany({
      where: { driverId, status: "OFFERED" },
      select: {
        id: true,
        bookingId: true,
        dispatchCycleId: true,
        attemptNumber: true,
      },
    });
    if (offers.length) {
      await prisma.dispatchOffer.updateMany({
        where: { id: { in: offers.map(({ id }) => id) }, status: "OFFERED" },
        data: {
          status: "REJECTED",
          respondedAt: new Date(),
          rejectionReason: "DRIVER_DISCONNECTED",
        },
      });
      for (const offer of offers) {
        emitDriver(driverId, "dispatch:offer-cancelled", {
          offerId: offer.id,
          bookingId: offer.bookingId,
          reason: "DRIVER_DISCONNECTED",
        });
        await queues.dispatch.add(
          "dispatch-next-batch",
          {
            bookingId: offer.bookingId,
            dispatchCycleId: offer.dispatchCycleId,
            attemptNumber: offer.attemptNumber,
          },
          {
            jobId: `disconnect-next-${offer.bookingId}-${offer.dispatchCycleId}-${offer.attemptNumber}`,
          },
        );
      }
    }
    return;
  }
  emitBooking(booking.id, "driver:availability-updated", {
    bookingId: booking.id,
    driverId,
    availability: "DISCONNECTED",
  });
  emitAdminRoom("tracking", "admin:driver:location-stale", {
    bookingId: booking.id,
    tripId: booking.trip?.id ?? null,
    driverId,
  });
  if (booking.status === "TRIP_STARTED") {
    if (booking.trip) await scheduleTripTrackingCheck(booking.trip.id);
    return;
  }
  await queues.maintenance.add(
    "assigned-driver-disconnect-check",
    { bookingId: booking.id, driverId },
    {
      jobId: `assigned-disconnect-${booking.id}-${driverId}`,
      delay: env.ASSIGNED_DRIVER_DISCONNECT_GRACE_SECONDS * 1_000,
      removeOnComplete: true,
    },
  );
};

const checkAssignedDriverDisconnect = async (
  bookingId: string,
  driverId: string,
) => {
  if (await presence.hasDriverConnections(driverId)) return;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, assignedDriverId: true },
  });
  if (
    !booking ||
    booking.assignedDriverId !== driverId ||
    !["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(
      booking.status,
    )
  ) {
    return;
  }
  await dispatch.redispatchForDriver(
    bookingId,
    driverId,
    "ASSIGNED_DRIVER_DISCONNECTED",
  );
};

const checkTripTracking = async (tripId: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, bookingId: true, driverId: true, status: true },
  });
  if (!trip || trip.status !== "STARTED") return;
  const raw = await redis.get(redisKeys.tripLastLocation(tripId));
  let fresh = false;
  if (raw) {
    try {
      const location = JSON.parse(raw) as { receivedAt?: string };
      fresh =
        typeof location.receivedAt === "string" &&
        Date.now() - new Date(location.receivedAt).getTime() <=
          env.TRIP_TRACKING_STALE_SECONDS * 1_000;
    } catch {
      fresh = false;
    }
  }
  if (!fresh) {
    emitBooking(trip.bookingId, "trip:issue-reported", {
      bookingId: trip.bookingId,
      tripId,
      code: "TRACKING_STALE",
    });
    emitAdminRoom("tracking", "admin:driver:location-stale", {
      bookingId: trip.bookingId,
      tripId,
      driverId: trip.driverId,
    });
  }
  await scheduleTripTrackingCheck(tripId);
};

const scheduleTripTrackingCheck = async (tripId: string) => {
  const slot = Math.floor(
    Date.now() / (env.TRIP_TRACKING_STALE_SECONDS * 1_000),
  );
  await queues.maintenance.add(
    "trip-tracking-stale-check",
    { tripId },
    {
      jobId: `trip-tracking-stale-${tripId}-${slot + 1}`,
      delay: env.TRIP_TRACKING_STALE_SECONDS * 1_000,
      removeOnComplete: true,
    },
  );
};

const reconcileRealtimeState = async () => {
  const [searching, assigned, busy, terminalOffers, completedTrips] =
    await Promise.all([
      prisma.booking.findMany({
        where: {
          status: "SEARCHING_DRIVER",
          dispatchCycles: { none: { status: "ACTIVE" } },
        },
        select: { id: true, version: true },
        take: 500,
      }),
      prisma.booking.findMany({
        where: {
          assignedDriverId: { not: null },
          status: {
            in: [
              "DRIVER_ASSIGNED",
              "DRIVER_ARRIVING",
              "DRIVER_ARRIVED",
              "TRIP_STARTED",
            ],
          },
          assignedDriver: { availability: { not: "BUSY" } },
        },
        select: { id: true, assignedDriverId: true },
        take: 500,
      }),
      prisma.driverProfile.findMany({
        where: {
          availability: "BUSY",
          currentBookings: {
            none: {
              status: {
                in: [
                  "DRIVER_ASSIGNED",
                  "DRIVER_ARRIVING",
                  "DRIVER_ARRIVED",
                  "TRIP_STARTED",
                ],
              },
            },
          },
        },
        select: { id: true },
        take: 500,
      }),
      prisma.dispatchOffer.findMany({
        where: {
          status: "OFFERED",
          booking: { status: { in: ["CANCELLED", "NO_DRIVER_FOUND"] } },
        },
        select: { id: true },
        take: 1_000,
      }),
      prisma.trip.findMany({
        where: { status: { in: ["COMPLETED", "CANCELLED"] } },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
    ]);
  for (const booking of searching) {
    await queues.dispatch.add(
      "dispatch-start",
      { bookingId: booking.id },
      { jobId: `dispatch-reconcile-${booking.id}-${booking.version}` },
    );
  }
  for (const booking of assigned) {
    if (!booking.assignedDriverId) continue;
    await prisma.driverProfile.update({
      where: { id: booking.assignedDriverId },
      data: { availability: "BUSY" },
    });
    await availability.markBusy(booking.assignedDriverId);
  }
  for (const driver of busy) await availability.restoreAvailable(driver.id);
  if (terminalOffers.length) {
    await prisma.dispatchOffer.updateMany({
      where: { id: { in: terminalOffers.map(({ id }) => id) } },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
  }
  if (completedTrips.length) {
    await redis.del(
      ...completedTrips.flatMap(({ id }) => [
        redisKeys.tripLive(id),
        redisKeys.tripLastLocation(id),
      ]),
    );
  }
};

const reconcileStaleDrivers = async () => {
  const drivers = await prisma.driverProfile.findMany({
    where: { availability: "ONLINE" },
    select: { id: true },
    take: 1_000,
  });
  if (!drivers.length) return;
  const locations = await redis.mget(
    drivers.map(({ id }) => redisKeys.driverLocation(id)),
  );
  for (let index = 0; index < drivers.length; index += 1) {
    if (locations[index]) continue;
    const driver = drivers[index]!;
    const active = await prisma.booking.count({
      where: {
        assignedDriverId: driver.id,
        status: {
          in: [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
          ],
        },
      },
    });
    if (!active) {
      console.log(`[DRIVER_PRESENCE] Location stale for driver ${driver.id}, retaining ONLINE availability for FCM notifications.`);
    }
  }
};

const ensureInvoice = async (tripId: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      fareBreakdown: true,
      booking: {
        include: {
          payments: {
            where: { status: "CAPTURED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const payment = trip?.booking.payments[0];
  if (!trip?.fareBreakdown || !payment) return;
  await prisma.invoice.upsert({
    where: { tripId },
    update: { paymentId: payment.id },
    create: {
      tripId,
      paymentId: payment.id,
      invoiceNumber: `INV-${tripId.replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      subtotal: trip.fareBreakdown.subtotal,
      tax: trip.fareBreakdown.tax,
      total: trip.fareBreakdown.total,
      currency: trip.booking.currency,
    },
  });
};

const processNotificationCampaign = async (campaignId: string) => {
  const claimed = await prisma.notificationCampaign.updateMany({
    where: { id: campaignId, status: { in: ["QUEUED", "SCHEDULED"] } },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (!claimed.count) return;
  const campaign = await prisma.notificationCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });
  const audience = campaign.audience as {
    type: string;
    userIds?: string[];
    status?: "ACTIVE" | "SUSPENDED" | "BLOCKED";
    role?: "CUSTOMER" | "DRIVER";
  };
  const roleFilter =
    audience.role ??
    (audience.type === "ALL_CUSTOMERS"
      ? "CUSTOMER"
      : audience.type === "ALL_DRIVERS"
        ? "DRIVER"
        : audience.type === "ADMINS"
          ? "ADMIN"
          : undefined);
  const users = await prisma.user.findMany({
    where: {
      id:
        audience.type === "SELECTED_USERS"
          ? { in: audience.userIds ?? [] }
          : undefined,
      status: audience.type === "USER_STATUS" ? audience.status : "ACTIVE",
      roles: roleFilter ? { some: { role: { name: roleFilter } } } : undefined,
    },
    select: { id: true },
    take: 50_000,
  });
  const rows = users.flatMap(({ id: userId }) =>
    campaign.channels.map((channel) => ({
      userId,
      campaignId,
      channel,
      templateKey: campaign.templateId
        ? `ADMIN_TEMPLATE:${campaign.templateId}`
        : "ADMIN_CAMPAIGN",
      title: campaign.title,
      body: campaign.body,
      data: campaign.data as never,
    })),
  );
  if (rows.length) {
    await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    const pending = await prisma.notification.findMany({
      where: { campaignId, status: "QUEUED" },
      select: { id: true },
    });
    for (const notification of pending) {
      await queues.notifications.add(
        "deliver",
        { notificationId: notification.id },
        { jobId: `notification-${notification.id}` },
      );
    }
  }
  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: rows.length ? "PROCESSING" : "COMPLETED",
      totalRecipients: users.length,
      completedAt: rows.length ? null : new Date(),
    },
  });
};

const finalizeNotificationCampaign = async (campaignId: string) => {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
    select: {
      status: true,
      channels: true,
      totalRecipients: true,
      sentCount: true,
      failedCount: true,
    },
  });
  if (!campaign || campaign.status !== "PROCESSING") return;
  const expectedDeliveries =
    campaign.totalRecipients * campaign.channels.length;
  if (campaign.sentCount + campaign.failedCount < expectedDeliveries) return;
  await prisma.notificationCampaign.updateMany({
    where: { id: campaignId, status: "PROCESSING" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
};

const checkPickupWaiting = async (tripId: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { booking: { include: { customer: true } } },
  });
  if (!trip || trip.status !== "DRIVER_ARRIVED") return;

  emitDriver(trip.driverId, "trip:issue-reported", {
    bookingId: trip.bookingId,
    tripId: trip.id,
    code: "CUSTOMER_NO_SHOW_WARNING",
  });

  await notifications.enqueue({
    userId: trip.booking.customer.userId,
    bookingId: trip.bookingId,
    channel: "PUSH",
    templateKey: "PICKUP_WAITING_WARNING",
    title: "Driver is waiting",
    body: "Your driver has been waiting at the pickup location for 5 minutes.",
    data: { event: "trip:pickup-waiting", bookingId: trip.bookingId },
  });
};

export const closeWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
};
