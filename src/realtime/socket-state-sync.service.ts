import type { Socket } from "socket.io";
import { prisma } from "../database/prisma";
import { redis } from "../infrastructure/redis";
import type { SocketAuth } from "./socket-auth.middleware";
import { redisKeys } from "./socket.constants";

const activeBookingStatuses = [
  "PENDING",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
  "PAYMENT_PENDING",
] as const;

export class SocketStateSyncService {
  async synchronize(socket: Socket) {
    const auth = socket.data.auth as SocketAuth;
    const state: Record<string, unknown> = {};

    if (auth.customerId) state.customer = await this.customer(auth.customerId);
    if (auth.driverId) state.driver = await this.driver(auth.driverId);
    if (auth.adminId) state.admin = await this.admin(auth.permissions);

    return state;
  }

  private async customer(customerId: string) {
    const booking = await prisma.booking.findFirst({
      where: { customerId, status: { in: [...activeBookingStatuses] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        type: true,
        scheduledAt: true,
        pickupAddress: true,
        dropAddress: true,
        estimatedFare: true,
        finalFare: true,
        assignedDriverId: true,
        assignedDriver: {
          select: {
            id: true,
            averageRating: true,
            user: { select: { displayName: true } },
          },
        },
        assignedVehicle: {
          select: {
            make: true,
            model: true,
            color: true,
            registrationNo: true,
          },
        },
        trip: {
          select: { id: true, status: true, verificationOtpExpiresAt: true },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            amount: true,
            provider: true,
            method: true,
          },
        },
        sosRequests: {
          where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, createdAt: true },
        },
        chatMessages: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            senderId: true,
            senderType: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });
    const location = booking?.assignedDriverId
      ? await redis.get(redisKeys.driverLocation(booking.assignedDriverId))
      : null;
    let latestEta = null;
    if (booking?.trip?.id) {
      const cachedEta = await redis.get(`trip:eta:${booking.trip.id}`);
      if (cachedEta) {
        try {
          latestEta = JSON.parse(cachedEta);
        } catch {
          // ignore
        }
      }
    }
    return {
      activeBooking: booking,
      bookingStatus: booking?.status ?? null,
      tripStatus: booking?.trip?.status ?? null,
      otpAvailable:
        booking?.trip?.status === "DRIVER_ARRIVED" &&
        booking.trip.verificationOtpExpiresAt &&
        booking.trip.verificationOtpExpiresAt > new Date()
          ? true
          : false,
      payment: booking?.payments[0] ?? null,
      activeSos: booking?.sosRequests[0] ?? null,
      chat: booking?.chatMessages?.slice().reverse() ?? [],
      latestDriverLocation: location ? JSON.parse(location) : null,
      latestEta,
    };
  }

  private async driver(driverId: string) {
    const [profile, offers, assignedBooking] = await Promise.all([
      prisma.driverProfile.findUnique({
        where: { id: driverId },
        select: {
          availability: true,
          vehicleAssignments: {
            where: { isActive: true },
            take: 1,
            select: {
              vehicle: {
                select: {
                  id: true,
                  categoryId: true,
                  registrationNo: true,
                  status: true,
                  verificationStatus: true,
                },
              },
            },
          },
        },
      }),
      prisma.dispatchOffer.findMany({
        where: {
          driverId,
          status: "OFFERED",
          expiresAt: { gt: new Date() },
          booking: { status: "SEARCHING_DRIVER" },
        },
        orderBy: { expiresAt: "asc" },
        select: {
          id: true,
          bookingId: true,
          expiresAt: true,
          attemptNumber: true,
        },
      }),
      prisma.booking.findFirst({
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
        select: {
          id: true,
          status: true,
          pickupAddress: true,
          dropAddress: true,
          trip: { select: { id: true, status: true } },
          customer: {
            select: {
              id: true,
              user: { select: { displayName: true, phone: true } },
            },
          },
        },
      }),
    ]);
    const liveStatus = await redis.get(redisKeys.driverAvailability(driverId));
    return {
      availability: profile?.availability ?? "OFFLINE",
      liveStatus: liveStatus ? JSON.parse(liveStatus) : null,
      selectedVehicle: profile?.vehicleAssignments[0]?.vehicle ?? null,
      activeOffers: offers,
      assignedBooking,
      activeTrip: assignedBooking?.trip ?? null,
      requiredNextAction: this.driverNextAction(assignedBooking?.status),
    };
  }

  private async admin(permissions: string[]) {
    const [searchingBookings, activeTrips, openSos] = await Promise.all([
      permissions.includes("dashboard.read")
        ? prisma.booking.count({ where: { status: "SEARCHING_DRIVER" } })
        : 0,
      permissions.includes("trips.monitor")
        ? prisma.trip.count({
            where: {
              status: {
                in: ["CREATED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "STARTED"],
              },
            },
          })
        : 0,
      permissions.includes("safety.manage")
        ? prisma.sosRequest.count({
            where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          })
        : 0,
    ]);
    return { searchingBookings, activeTrips, openSos };
  }

  private driverNextAction(status: string | undefined) {
    if (status === "DRIVER_ASSIGNED") return "HEAD_TO_PICKUP";
    if (status === "DRIVER_ARRIVING") return "MARK_ARRIVED";
    if (status === "DRIVER_ARRIVED") return "VERIFY_TRIP_OTP";
    if (status === "TRIP_STARTED") return "CONTINUE_TRIP";
    return "WAIT_FOR_OFFER";
  }
}
