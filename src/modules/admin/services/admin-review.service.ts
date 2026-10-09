import { Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import type { AdminActionContext } from "../admin.constants";

export type AdminReviewStatus = "APPROVED" | "HIDDEN" | "FLAGGED";

export type AdminReviewListInput = {
  page: number;
  limit: number;
  search?: string;
  status?: AdminReviewStatus;
};

export type AdminReviewDto = {
  id: string;
  ratingId: string;
  tripId: string;
  bookingId: string;
  reviewerType: "CUSTOMER" | "DRIVER";
  reviewerName: string;
  reviewerEmail: string | null;
  reviewerPhone: string | null;
  targetName: string;
  targetEmail: string | null;
  targetPhone: string | null;
  targetType: string;
  rating: number;
  comment: string;
  status: AdminReviewStatus;
  isHidden: boolean;
  reportsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminReviewStats = {
  totalReviews: number;
  averageRating: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  approvedReviews: number;
  hiddenReviews: number;
  flaggedReviews: number;
};

const reviewInclude = {
  reports: true,
  rating: {
    include: {
      author: {
        select: { id: true, displayName: true, email: true, phone: true },
      },
      subject: {
        select: { id: true, displayName: true, email: true, phone: true },
      },
      trip: { select: { id: true, bookingId: true } },
    },
  },
} satisfies Prisma.ReviewInclude;

type ReviewWithRelations = Prisma.ReviewGetPayload<{
  include: typeof reviewInclude;
}>;

const displayName = (user: {
  displayName: string | null;
  email: string | null;
  phone: string;
}) => user.displayName || user.email || user.phone;

const statusFor = (review: {
  isHidden: boolean;
  reports: Array<{ status: string }>;
}): AdminReviewStatus => {
  if (review.isHidden) return "HIDDEN";
  return review.reports.some((report) =>
    ["PENDING", "UNDER_REVIEW"].includes(report.status),
  )
    ? "FLAGGED"
    : "APPROVED";
};

const dto = (review: ReviewWithRelations): AdminReviewDto => ({
  id: review.id,
  ratingId: review.ratingId,
  tripId: review.rating.tripId,
  bookingId: review.rating.trip.bookingId,
  reviewerType: review.rating.subjectType === "DRIVER" ? "CUSTOMER" : "DRIVER",
  reviewerName: displayName(review.rating.author),
  reviewerEmail: review.rating.author.email,
  reviewerPhone: review.rating.author.phone,
  targetName: displayName(review.rating.subject),
  targetEmail: review.rating.subject.email,
  targetPhone: review.rating.subject.phone,
  targetType: review.rating.subjectType,
  rating: review.rating.score,
  comment: review.comment,
  status: statusFor(review),
  isHidden: review.isHidden,
  reportsCount: review.reports.length,
  createdAt: review.createdAt.toISOString(),
  updatedAt: review.updatedAt.toISOString(),
});

export class AdminReviewService {
  async list(input: AdminReviewListInput) {
    const skip = (input.page - 1) * input.limit;
    const where = this.where(input);

    const [items, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: input.limit,
        orderBy: { createdAt: "desc" },
        include: reviewInclude,
      }),
      prisma.review.count({ where }),
    ]);

    return {
      items: items.map(dto),
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
    };
  }

  async get(id: string) {
    const review = await prisma.review.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!review) throw errors.notFound("Review not found");
    return dto(review);
  }

  async statistics(): Promise<AdminReviewStats> {
    const [totalReviews, average, grouped, hiddenReviews, flaggedReviews] =
      await Promise.all([
        prisma.review.count(),
        prisma.rating.aggregate({ _avg: { score: true } }),
        prisma.rating.groupBy({
          by: ["score"],
          _count: { _all: true },
          where: { review: { isNot: null } },
        }),
        prisma.review.count({ where: { isHidden: true } }),
        prisma.review.count({
          where: {
            isHidden: false,
            reports: { some: { status: { in: ["PENDING", "UNDER_REVIEW"] } } },
          },
        }),
      ]);

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    for (const group of grouped) {
      if ([1, 2, 3, 4, 5].includes(group.score)) {
        distribution[group.score as 1 | 2 | 3 | 4 | 5] = group._count._all;
      }
    }

    return {
      totalReviews,
      averageRating: Number((average._avg.score ?? 0).toFixed(2)),
      distribution,
      approvedReviews: totalReviews - hiddenReviews - flaggedReviews,
      hiddenReviews,
      flaggedReviews,
    };
  }

  async updateVisibility(
    id: string,
    isHidden: boolean,
    _actor: AdminActionContext,
  ) {
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw errors.notFound("Review not found");

    const updated = await prisma.review.update({
      where: { id },
      data: { isHidden },
      include: reviewInclude,
    });

    return dto(updated);
  }

  async delete(id: string, _actor: AdminActionContext) {
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw errors.notFound("Review not found");

    await prisma.review.delete({ where: { id } });
    return { id };
  }

  private where(input: AdminReviewListInput): Prisma.ReviewWhereInput {
    const clauses: Prisma.ReviewWhereInput[] = [];
    const search = input.search?.trim();

    if (search) {
      clauses.push({
        OR: [
          { id: this.uuidFilter(search) },
          { comment: { contains: search, mode: "insensitive" } },
          {
            rating: {
              author: {
                displayName: { contains: search, mode: "insensitive" },
              },
            },
          },
          {
            rating: {
              author: { email: { contains: search, mode: "insensitive" } },
            },
          },
          { rating: { author: { phone: { contains: search } } } },
          {
            rating: {
              subject: {
                displayName: { contains: search, mode: "insensitive" },
              },
            },
          },
          {
            rating: {
              subject: { email: { contains: search, mode: "insensitive" } },
            },
          },
          { rating: { subject: { phone: { contains: search } } } },
        ].filter(Boolean) as Prisma.ReviewWhereInput[],
      });
    }

    if (input.status === "APPROVED") {
      clauses.push({
        isHidden: false,
        reports: { none: { status: { in: ["PENDING", "UNDER_REVIEW"] } } },
      });
    } else if (input.status === "HIDDEN") {
      clauses.push({ isHidden: true });
    } else if (input.status === "FLAGGED") {
      clauses.push({
        isHidden: false,
        reports: { some: { status: { in: ["PENDING", "UNDER_REVIEW"] } } },
      });
    }

    return clauses.length ? { AND: clauses } : {};
  }

  private uuidFilter(search: string): Prisma.StringFilter | undefined {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      search,
    )
      ? { equals: search }
      : undefined;
  }
}
