import { RatingSubjectType, Prisma } from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";

export class RatingsService {
  async create(
    tripId: string,
    authorUserId: string,
    input: {
      subjectUserId?: string;
      subjectType?: RatingSubjectType;
      score: number;
      tags?: string[];
      comment?: string;
    },
  ) {
    let trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        driver: true,
        booking: { include: { customer: true } },
      },
    });

    if (!trip) {
      trip = await prisma.trip.findFirst({
        where: { bookingId: tripId },
        include: {
          driver: true,
          booking: { include: { customer: true } },
        },
      });
    }

    if (!trip) {
      throw errors.notFound("Trip or Booking not found for rating");
    }

    const customerUserId = trip.booking.customer.userId;
    const driverUserId = trip.driver.userId;

    const subjectType =
      input.subjectType ??
      (authorUserId === customerUserId
        ? RatingSubjectType.DRIVER
        : RatingSubjectType.CUSTOMER);

    const subjectUserId =
      input.subjectUserId ??
      (subjectType === RatingSubjectType.DRIVER
        ? driverUserId
        : customerUserId);

    const validPair =
      (authorUserId === customerUserId &&
        subjectUserId === driverUserId &&
        subjectType === RatingSubjectType.DRIVER) ||
      (authorUserId === driverUserId &&
        subjectUserId === customerUserId &&
        subjectType === RatingSubjectType.CUSTOMER);

    if (!validPair) throw errors.forbidden("Rating relationship is invalid");

    const tags = input.tags ?? [];
    const actualTripId = trip.id;
    return prisma.$transaction(
      async (tx) => {
        const rating = await tx.rating.create({
          data: {
            tripId: actualTripId,
            authorUserId,
            subjectUserId,
            subjectType,
            score: input.score,
            tags,
            review: input.comment
              ? { create: { comment: input.comment } }
              : undefined,
          },
          include: { review: true },
        });
        if (input.subjectType === RatingSubjectType.DRIVER) {
          const aggregate = await tx.rating.aggregate({
            where: {
              subjectUserId: input.subjectUserId,
              subjectType: RatingSubjectType.DRIVER,
            },
            _avg: { score: true },
          });
          await tx.driverProfile.update({
            where: { userId: input.subjectUserId },
            data: {
              averageRating: new Prisma.Decimal(aggregate._avg.score ?? 0),
            },
          });
        }
        return rating;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
