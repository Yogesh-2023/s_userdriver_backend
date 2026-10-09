import { CouponDiscountType, Prisma, RideType } from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import { env } from "../../config/env";

export class PricingService {
  async estimateForUser(
    userId: string,
    input: Omit<Parameters<PricingService["calculate"]>[0], "customerId">,
  ) {
    const customer = await prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return this.calculate({ ...input, customerId: customer?.id });
  }

  async calculate(input: {
    vehicleCategoryId: string;
    rideType: RideType;
    distanceMeters: number;
    durationSeconds: number;
    waitingMinutes?: number;
    tollCharge?: number;
    couponCode?: string;
    customerId?: string;
  }) {
    const now = new Date();
    const [rule, surge] = await Promise.all([
      prisma.pricingRule.findFirst({
        where: {
          vehicleCategoryId: input.vehicleCategoryId,
          rideType: input.rideType,
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.surgePricingRule.findFirst({
        where: {
          vehicleCategoryId: input.vehicleCategoryId,
          isActive: true,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        orderBy: { multiplier: "desc" },
      }),
    ]);

    const activeRule = rule;
    if (!activeRule) {
      throw errors.badRequest("No active fare configuration found for this vehicle category. Please contact support or configure fares in the Admin portal.");
    }

    const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
    const baseFare = money(activeRule.baseFare);
    const distanceCharge = money(activeRule.perKilometer)
      .mul(input.distanceMeters)
      .div(1_000);
    const timeCharge = money(activeRule.perMinute)
      .mul(input.durationSeconds)
      .div(60);
    const waitingCharge = money(activeRule.waitingPerMinute).mul(
      input.waitingMinutes ?? 0,
    );
    const tollCharge = money(input.tollCharge ?? 0);
    const beforeSurge = baseFare
      .add(distanceCharge)
      .add(timeCharge)
      .add(waitingCharge);
    const surgeMultiplier = surge?.multiplier ?? money(1);
    const surgeCharge = beforeSurge.mul(surgeMultiplier.sub(1));
    let subtotal = beforeSurge.add(surgeCharge).add(tollCharge);
    if (subtotal.lessThan(activeRule.minimumFare))
      subtotal = money(activeRule.minimumFare);

    let discount = money(0);
    let couponId: string | undefined;
    if (input.couponCode) {
      if (!input.customerId) throw errors.badRequest("Customer is required");
      const coupon = await prisma.coupon.findUnique({
        where: { code: input.couponCode.trim().toUpperCase() },
        include: { _count: { select: { usages: true } } },
      });
      if (
        !coupon ||
        !coupon.isActive ||
        coupon.validFrom > now ||
        coupon.validUntil <= now ||
        coupon.minimumFare.greaterThan(subtotal) ||
        (coupon.maxUses !== null && coupon._count.usages >= coupon.maxUses)
      ) {
        throw errors.badRequest("Coupon is invalid or not applicable");
      }
      const userUses = await prisma.couponUsage.count({
        where: { couponId: coupon.id, customerId: input.customerId },
      });
      if (userUses >= coupon.maxUsesPerUser) {
        throw errors.badRequest("Coupon usage limit reached");
      }
      discount =
        coupon.discountType === CouponDiscountType.FIXED
          ? money(coupon.discountValue)
          : subtotal.mul(coupon.discountValue).div(100);
      if (coupon.maxDiscount && discount.greaterThan(coupon.maxDiscount)) {
        discount = money(coupon.maxDiscount);
      }
      if (discount.greaterThan(subtotal)) discount = subtotal;
      couponId = coupon.id;
    } else if (input.customerId) {
      // Check for first-ride referral discount
      const priorBookings = await prisma.booking.count({
        where: { customerId: input.customerId },
      });
      if (priorBookings === 0) {
        const referral = await prisma.referral.findUnique({
          where: { referredCustomerId: input.customerId },
        });
        if (referral) {
          const { AdminConfigService } =
            await import("../admin/services/admin-config.service");
          const configService = new AdminConfigService();

          let percentage = 10;
          let maxCap = null;
          try {
            const pSetting = await configService.get(
              "referral.discount_percentage",
            );
            if (pSetting && typeof pSetting.value === "number")
              percentage = pSetting.value;
          } catch {}
          try {
            const capSetting = await configService.get(
              "referral.max_discount_cap",
            );
            if (capSetting && typeof capSetting.value === "number")
              maxCap = capSetting.value;
          } catch {}

          discount = subtotal.mul(percentage).div(100);
          if (maxCap !== null && discount.greaterThan(maxCap)) {
            discount = money(maxCap);
          }
          if (discount.greaterThan(subtotal)) discount = subtotal;

          // Using a temporary property to pass referral info back without changing too many types
          (input as any)._referralId = referral.id;
        }
      }
    }

    const taxable = subtotal.sub(discount);
    const tax = taxable.mul(activeRule.taxPercentage).div(100);
    const platformCommission = taxable
      .mul(activeRule.platformCommission)
      .div(100);
    const total = taxable
      .add(tax)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const number = (value: Prisma.Decimal) =>
      value.toDecimalPlaces(2).toNumber();
    return {
      baseFare: number(baseFare),
      distanceCharge: number(distanceCharge),
      timeCharge: number(timeCharge),
      waitingCharge: number(waitingCharge),
      tollCharge: number(tollCharge),
      surgeMultiplier: surgeMultiplier.toNumber(),
      surgeCharge: number(surgeCharge),
      subtotal: number(subtotal),
      discount: number(discount),
      tax: number(tax),
      platformCommission: number(platformCommission),
      total: number(total),
      currency: "INR" as const,
      couponId,
      referralId: (input as any)._referralId,
      referralDiscount: (input as any)._referralId ? number(discount) : 0,
      calculationSnapshot: {
        pricingRuleId: activeRule.id,
        surgeRuleId: surge?.id,
        distanceMeters: input.distanceMeters,
        durationSeconds: input.durationSeconds,
        waitingMinutes: input.waitingMinutes ?? 0,
        platformCommissionPercentage: activeRule.platformCommission.toNumber(),
      },
    };
  }
}
