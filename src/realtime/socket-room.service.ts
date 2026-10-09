import type { Socket } from "socket.io";
import { prisma } from "../database/prisma";
import { ADMIN_ROOM_PERMISSIONS } from "../modules/admin/admin.constants";
import type { SocketAuth } from "./socket-auth.middleware";
import { redisKeys } from "./socket.constants";

export const canJoinAdminRoom = (
  room: string,
  auth: { roles: string[]; permissions: string[] },
): boolean => {
  if (auth.roles.includes("SUPER_ADMIN")) {
    return room in ADMIN_ROOM_PERMISSIONS;
  }
  const required =
    ADMIN_ROOM_PERMISSIONS[room as keyof typeof ADMIN_ROOM_PERMISSIONS];
  if (!required) return false;
  return auth.permissions.includes(required);
};

export const joinPersonalRooms = async (socket: Socket) => {
  const auth = socket.data.auth as SocketAuth;

  await socket.join(`user:${auth.userId}`);
  await socket.join(redisKeys.sessionRoom(auth.sessionId));

  if (auth.customerId) {
    await socket.join(`customer:${auth.customerId}`);
  }

  if (auth.driverId) {
    await socket.join(`driver:${auth.driverId}`);
  }

  if (auth.adminId) {
    await socket.join(`admin:${auth.adminId}`);

    // Join appropriate admin operational rooms based on permissions
    for (const [room, permission] of Object.entries(ADMIN_ROOM_PERMISSIONS)) {
      if (
        auth.roles.includes("SUPER_ADMIN") ||
        auth.permissions.includes(permission)
      ) {
        await socket.join(room);
      }
    }
  }

  await joinActiveRideRooms(socket);
};

export const joinActiveRideRooms = async (socket: Socket) => {
  const auth = socket.data.auth as SocketAuth;
  if (auth.customerId) {
    const bookings = await prisma.booking.findMany({
      where: {
        customerId: auth.customerId,
        status: {
          in: [
            "PENDING",
            "SEARCHING_DRIVER",
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
            "TRIP_COMPLETED",
            "PAYMENT_PENDING",
          ],
        },
      },
      select: { id: true, trip: { select: { id: true } } },
      take: 5,
    });
    for (const booking of bookings) {
      await joinRideRooms(socket, booking.id, booking.trip?.id);
    }
  }
  if (auth.driverId) {
    const booking = await prisma.booking.findFirst({
      where: {
        assignedDriverId: auth.driverId,
        status: {
          in: [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
          ],
        },
      },
      select: { id: true, trip: { select: { id: true } } },
    });
    if (booking) {
      await joinRideRooms(socket, booking.id, booking.trip?.id);
    }
    const offered = await prisma.dispatchOffer.findMany({
      where: {
        driverId: auth.driverId,
        status: "OFFERED",
        expiresAt: { gt: new Date() },
      },
      select: { bookingId: true },
      take: 10,
    });
    for (const offer of offered) {
      await socket.join(`booking:${offer.bookingId}`);
    }
  }
};

const joinRideRooms = async (
  socket: Socket,
  bookingId: string,
  tripId?: string,
) => {
  await socket.join(`booking:${bookingId}`);
  await socket.join(`booking:${bookingId}:track`);
  await socket.join(`booking:${bookingId}:chat`);
  if (tripId) await socket.join(`trip:${tripId}`);
};

export const canJoinOperationalRoom = async (
  room: string,
  auth: SocketAuth,
): Promise<boolean> => {
  const [kind, id, extra] = room.split(":");
  if (!id || extra) return false;

  if (auth.roles.includes("SUPER_ADMIN")) {
    return kind === "booking" || kind === "trip";
  }
  if (auth.roles.includes("ADMIN")) {
    return kind === "booking"
      ? auth.permissions.includes("bookings.read")
      : kind === "trip" && auth.permissions.includes("trips.monitor");
  }

  if (kind === "booking") {
    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        customer: { select: { userId: true } },
        dispatchOffers: {
          where: { status: "ACCEPTED" },
          select: { driver: { select: { userId: true } } },
        },
      },
    });
    return Boolean(
      booking &&
      (booking.customer.userId === auth.userId ||
        booking.dispatchOffers.some(
          ({ driver }) => driver.userId === auth.userId,
        )),
    );
  }

  if (kind === "trip") {
    const trip = await prisma.trip.findUnique({
      where: { id },
      select: {
        driver: { select: { userId: true } },
        booking: {
          select: { customer: { select: { userId: true } } },
        },
      },
    });
    return Boolean(
      trip &&
      (trip.booking.customer.userId === auth.userId ||
        trip.driver.userId === auth.userId),
    );
  }

  return false;
};
