import { RatingSubjectType } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class CustomerRatingService {
  async create(
    userId: string,
    tripId: string,
    input: { score: number; comment?: string },
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        booking: { include: { customer: true } },
        driver: true,
      },
    });

    if (!trip || trip.booking.customer.userId !== userId) {
      throw errors.notFound("Trip not found");
    }
    if (trip.status !== "COMPLETED") {
      throw errors.conflict("Cannot rate a trip that is not completed");
    }

    // Validate rating
    if (input.score < 1 || input.score > 5 || !Number.isInteger(input.score)) {
      throw errors.badRequest(
        "Rating score must be an integer between 1 and 5",
      );
    }
    if (input.comment && input.comment.trim().length === 0) {
      input.comment = undefined;
    }
    if (input.comment && input.comment.length > 1000) {
      throw errors.badRequest("Review comment must not exceed 1000 characters");
    }

    // Check duplicate rating
    const existing = await prisma.rating.findFirst({
      where: {
        tripId,
        authorUserId: userId,
        subjectType: RatingSubjectType.DRIVER,
      },
    });
    if (existing) throw errors.conflict("You have already rated this trip");

    const { AdminConfigService } =
      await import("../../admin/services/admin-config.service");
    const configService = new AdminConfigService();
    let attentionThreshold = 2;
    try {
      const thresholdSetting = await configService.get(
        "rating.attention_threshold",
      );
      if (thresholdSetting && typeof thresholdSetting.value === "number") {
        attentionThreshold = thresholdSetting.value;
      }
    } catch {}

    const result = await prisma.$transaction(async (tx) => {
      const rating = await tx.rating.create({
        data: {
          tripId,
          authorUserId: userId,
          subjectUserId: trip.driver.userId,
          subjectType: RatingSubjectType.DRIVER,
          score: input.score,
          tags: [], // Deprecated in favor of Review model
          ...(input.comment
            ? {
                review: {
                  create: {
                    comment: input.comment.trim(),
                    isHidden: false,
                  },
                },
              }
            : {}),
        },
        include: { review: true },
      });

      if (input.score <= attentionThreshold) {
        await tx.attentionQueue.create({
          data: {
            tripId,
            ratingId: rating.id,
            reviewId: rating.review?.id ?? null,
            driverId: trip.driverId,
            customerId: trip.booking.customerId,
            priority: "NORMAL",
            reason: `LOW_RATING_${input.score}_STAR`,
          },
        });
      }

      // Fetch all valid ratings for the driver to recalculate average
      const aggregates = await tx.rating.aggregate({
        where: {
          subjectUserId: trip.driver.userId,
          subjectType: RatingSubjectType.DRIVER,
          OR: [{ review: null }, { review: { isHidden: false } }],
        },
        _avg: { score: true },
        _count: { id: true },
      });

      // Update DriverProfile
      await tx.driverProfile.update({
        where: { id: trip.driverId },
        data: {
          averageRating: aggregates._avg.score
            ? aggregates._avg.score.toString()
            : "0.0",
        },
      });

      return rating;
    });

    return result;
  }

  async list(userId: string) {
    return prisma.rating.findMany({
      where: { authorUserId: userId },
      include: {
        trip: {
          include: {
            booking: {
              select: {
                pickupAddress: true,
                dropAddress: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(
    userId: string,
    ratingId: string,
    input: { score?: number; comment?: string },
  ) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
      include: { subject: { include: { driverProfile: true } } },
    });
    if (!rating || rating.authorUserId !== userId) {
      throw errors.notFound("Rating not found");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.rating.update({
        where: { id: ratingId },
        data: {
          ...(input.score !== undefined ? { score: input.score } : {}),
          ...(input.comment !== undefined
            ? {
                review: {
                  upsert: {
                    create: { comment: input.comment.trim(), isHidden: false },
                    update: { comment: input.comment.trim() },
                  },
                },
              }
            : {}),
        },
      });

      // Re-fetch all ratings for the driver to recalculate average
      const aggregates = await tx.rating.aggregate({
        where: {
          subjectUserId: rating.subjectUserId,
          subjectType: RatingSubjectType.DRIVER,
          OR: [{ review: null }, { review: { isHidden: false } }],
        },
        _avg: { score: true },
        _count: { id: true },
      });

      const driverProfile = rating.subject.driverProfile;
      if (driverProfile) {
        await tx.driverProfile.update({
          where: { id: driverProfile.id },
          data: {
            averageRating: aggregates._avg.score
              ? aggregates._avg.score.toString()
              : "0.0",
            totalTrips: aggregates._count.id,
          },
        });
      }

      return updated;
    });

    return result;
  }

  async reportReview(
    userId: string,
    reviewId: string,
    input: { reason: string; description?: string },
  ) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        rating: { include: { trip: { include: { booking: true } } } },
      },
    });
    if (!review) throw errors.notFound("Review not found");

    const existingReport = await prisma.reviewReport.findUnique({
      where: { reviewId_reporterId: { reviewId, reporterId: userId } },
    });
    if (existingReport) {
      throw errors.conflict("You have already reported this review");
    }

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.reviewReport.create({
        data: {
          reviewId,
          reporterId: userId,
          reason: input.reason,
          description: input.description,
        },
      });

      // Escalate or create AttentionQueue
      const existingQueue = await tx.attentionQueue.findFirst({
        where: { reviewId, status: "OPEN" },
      });

      if (existingQueue) {
        if (existingQueue.priority === "NORMAL") {
          await tx.attentionQueue.update({
            where: { id: existingQueue.id },
            data: {
              priority: "HIGH",
              reason: existingQueue.reason + "_AND_REPORTED",
            },
          });
        }
      } else {
        await tx.attentionQueue.create({
          data: {
            tripId: review.rating.tripId,
            ratingId: review.rating.id,
            reviewId,
            driverId: review.rating.trip.driverId,
            customerId: review.rating.trip.booking.customerId,
            priority: "HIGH",
            reason: "REPORTED_REVIEW",
          },
        });
      }

      return report;
    });

    return result;
  }
}
