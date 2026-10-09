import { BookingStatus } from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { emitBooking } from "../../infrastructure/realtime";
import { redis } from "../../infrastructure/redis";
import { REALTIME_TTL } from "../../realtime/socket.constants";

const chatStatuses: BookingStatus[] = [
  BookingStatus.DRIVER_ASSIGNED,
  BookingStatus.DRIVER_ARRIVING,
  BookingStatus.DRIVER_ARRIVED,
  BookingStatus.TRIP_STARTED,
];

export class RideChatService {
  async send(input: {
    userId: string;
    bookingId: string;
    message: string;
    senderType: "CUSTOMER" | "DRIVER";
    customerId?: string;
    driverId?: string;
    clientMessageId?: string;
  }) {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        status: true,
        customerId: true,
        assignedDriverId: true,
      },
    });
    if (!booking) throw errors.notFound("BOOKING_NOT_FOUND");
    const authorized =
      (input.senderType === "CUSTOMER" &&
        input.customerId === booking.customerId) ||
      (input.senderType === "DRIVER" &&
        input.driverId === booking.assignedDriverId);
    if (!authorized) throw errors.forbidden("BOOKING_ACCESS_DENIED");
    if (!chatStatuses.includes(booking.status)) {
      throw errors.conflict("Booking chat is not active");
    }

    if (input.clientMessageId) {
      const idempotencyKey = `chat:idem:${input.userId}:${input.clientMessageId}`;
      const created = await redis.set(
        idempotencyKey,
        "1",
        "EX",
        REALTIME_TTL.IDEMPOTENCY_SECONDS,
        "NX",
      );
      if (!created) {
        const existing = await prisma.chatMessage.findFirst({
          where: {
            bookingId: input.bookingId,
            senderId: input.userId,
            content: input.message,
          },
          orderBy: { createdAt: "desc" },
        });
        if (existing) return this.payload(existing, input.senderType);
      }
    }

    const msg = await prisma.chatMessage.create({
      data: {
        bookingId: input.bookingId,
        senderId: input.userId,
        senderType: input.senderType,
        content: input.message,
      },
    });
    const payload = this.payload(msg, input.senderType);
    emitBooking(input.bookingId, "booking:chat_message", payload);
    emitBooking(input.bookingId, "chat:message", payload);
    return payload;
  }

  async history(bookingId: string, take = 50) {
    return prisma.chatMessage.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  private payload(
    msg: {
      id: string;
      bookingId: string;
      senderId: string;
      senderType: string;
      content: string;
      createdAt: Date;
    },
    senderRole: "CUSTOMER" | "DRIVER",
  ) {
    return {
      bookingId: msg.bookingId,
      messageId: msg.id,
      senderUserId: msg.senderId,
      senderRole,
      message: msg.content,
      sentAt: msg.createdAt,
    };
  }
}
