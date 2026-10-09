import { CouponDiscountType, Prisma } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";

export class CustomerMarketingService {
  private async getCustomer(userId: string) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true, referralCode: true, userId: true },
    });
    if (!customer) throw errors.notFound("Customer profile not found");
    return customer;
  }

  async listOffers(userId: string) {
    await this.getCustomer(userId);
    // Returns active system offers
    const coupons = await prisma.coupon.findMany({
      where: { isActive: true, validUntil: { gt: new Date() } },
      select: {
        id: true,
        code: true,
        discountType: true,
        discountValue: true,
        maxDiscount: true,
        minimumFare: true,
      },
      take: 10,
    });

    return coupons.map((c) => ({
      ...c,
      description: `Get up to ₹${c.maxDiscount ? Number(c.maxDiscount) : Number(c.discountValue)} off on your ride`,
    }));
  }

  async listAvailableCoupons(userId: string) {
    const customer = await this.getCustomer(userId);
    const now = new Date();
    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gt: now },
      },
      include: {
        usages: { where: { customerId: customer.id } },
        _count: { select: { usages: true } },
      },
    });

    const priorBookingsCount = await prisma.booking.count({
      where: { customerId: customer.id },
    });

    // Filter coupons based on limits
    return coupons
      .filter((c) => {
        if (c.maxUses !== null && c._count.usages >= c.maxUses) return false;
        if (c.usages.length >= c.maxUsesPerUser) return false;
        if (c.newUsersOnly && priorBookingsCount > 0) return false;
        return true;
      })
      .map((c) => ({
        id: c.id,
        code: c.code,
        description: `Get up to ₹${c.maxDiscount ? Number(c.maxDiscount) : Number(c.discountValue)} off on your ride`,
        discountType: c.discountType,
        discountValue: Number(c.discountValue),
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
        minimumFare: Number(c.minimumFare),
        validUntil: c.validUntil,
      }));
  }

  async validateCoupon(
    userId: string,
    code: string,
    subtotal: number,
    categoryId?: string,
  ) {
    const customer = await this.getCustomer(userId);
    const now = new Date();
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
      include: { _count: { select: { usages: true } } },
    });

    if (!coupon || !coupon.isActive) throw errors.badRequest("COUPON_INVALID");
    if (coupon.validFrom > now || coupon.validUntil <= now)
      throw errors.badRequest("COUPON_EXPIRED");
    if (coupon.minimumFare.greaterThan(subtotal))
      throw errors.badRequest("Minimum subtotal requirement not met");
    if (categoryId && coupon.categoryId && coupon.categoryId !== categoryId)
      throw errors.badRequest("Coupon not valid for this vehicle category");

    if (coupon.newUsersOnly) {
      const priorBookings = await prisma.booking.count({
        where: { customerId: customer.id },
      });
      if (priorBookings > 0)
        throw errors.badRequest("Coupon valid for new users only");
    }

    if (coupon.maxUses !== null && coupon._count.usages >= coupon.maxUses) {
      throw errors.badRequest("COUPON_USAGE_LIMIT_REACHED");
    }

    const userUses = await prisma.couponUsage.count({
      where: { couponId: coupon.id, customerId: customer.id },
    });
    if (userUses >= coupon.maxUsesPerUser) {
      throw errors.badRequest("COUPON_USAGE_LIMIT_REACHED");
    }

    let discount =
      coupon.discountType === CouponDiscountType.FIXED
        ? coupon.discountValue
        : new Prisma.Decimal(subtotal).mul(coupon.discountValue).div(100);

    if (coupon.maxDiscount && discount.greaterThan(coupon.maxDiscount)) {
      discount = coupon.maxDiscount;
    }
    if (discount.greaterThan(subtotal)) {
      discount = new Prisma.Decimal(subtotal);
    }

    // Ensure final discount does not result in negative subtotal
    if (discount.isNegative()) discount = new Prisma.Decimal(0);

    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      discount: Number(discount),
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      finalFare: Math.max(0, subtotal - Number(discount)),
    };
  }

  async calculateReferralDiscount(userId: string, subtotal: number) {
    const customer = await this.getCustomer(userId);

    // Check if user was referred
    const referral = await prisma.referral.findUnique({
      where: { referredCustomerId: customer.id },
    });
    if (!referral) return null;

    // Check if it's the first ride
    const priorBookings = await prisma.booking.count({
      where: { customerId: customer.id },
    });
    if (priorBookings > 0) return null;

    const { AdminConfigService } =
      await import("../../admin/services/admin-config.service");
    const configService = new AdminConfigService();

    let percentage = 10;
    let maxCap = null;
    try {
      const pSetting = await configService.get("referral.discount_percentage");
      if (pSetting && typeof pSetting.value === "number")
        percentage = pSetting.value;
    } catch {}
    try {
      const capSetting = await configService.get("referral.max_discount_cap");
      if (capSetting && typeof capSetting.value === "number")
        maxCap = capSetting.value;
    } catch {}

    let discount = new Prisma.Decimal(subtotal).mul(percentage).div(100);

    if (maxCap !== null && discount.greaterThan(maxCap)) {
      discount = new Prisma.Decimal(maxCap);
    }
    if (discount.greaterThan(subtotal)) {
      discount = new Prisma.Decimal(subtotal);
    }

    return {
      referralId: referral.id,
      percentage,
      discountAmount: Number(discount),
    };
  }

  async getCouponHistory(userId: string) {
    const customer = await this.getCustomer(userId);
    const usages = await prisma.couponUsage.findMany({
      where: { customerId: customer.id },
      include: {
        coupon: {
          select: { code: true, maxDiscount: true, discountValue: true },
        },
        booking: { select: { pickupAddress: true, dropAddress: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return usages.map((u) => ({
      id: u.id,
      couponId: u.couponId,
      customerId: u.customerId,
      bookingId: u.bookingId,
      discount: Number(u.discount),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      coupon: {
        code: u.coupon.code,
        description: `Get up to ₹${u.coupon.maxDiscount ? Number(u.coupon.maxDiscount) : Number(u.coupon.discountValue)} off on your ride`,
      },
      booking: u.booking,
    }));
  }

  async getReferralCode(userId: string) {
    const customer = await this.getCustomer(userId);
    return { referralCode: customer.referralCode };
  }

  async applyReferralCode(userId: string, referralCode: string) {
    const customer = await this.getCustomer(userId);
    const code = referralCode.trim().toUpperCase();
    if (customer.referralCode === code) {
      throw errors.badRequest("Self-referrals are not allowed");
    }

    const referrer = await prisma.customerProfile.findUnique({
      where: { referralCode: code },
    });
    if (!referrer) throw errors.badRequest("Referral code is invalid");

    // Verify if this user has already used a referral code
    const existing = await prisma.referral.findUnique({
      where: { referredCustomerId: customer.id },
    });
    if (existing)
      throw errors.conflict("You have already applied a referral code");

    const result = await prisma.referral.create({
      data: {
        referrerCustomerId: referrer.id,
        referredCustomerId: customer.id,
        code,
      },
    });

    return result;
  }

  async listReferrals(userId: string) {
    const customer = await this.getCustomer(userId);
    return prisma.referral.findMany({
      where: { referrerCustomerId: customer.id },
      include: {
        referred: {
          select: {
            user: { select: { displayName: true } },
            createdAt: true,
          },
        },
      },
    });
  }

  async listRewards(userId: string) {
    const customer = await this.getCustomer(userId);
    return prisma.referralReward.findMany({
      where: { userId: customer.userId },
      include: {
        referral: {
          include: {
            referred: {
              select: { user: { select: { displayName: true } } },
            },
          },
        },
      },
    });
  }
}
