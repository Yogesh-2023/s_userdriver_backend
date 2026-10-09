import {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { errors } from "../../common/errors";
import { prisma } from "../../database/prisma";
import {
  emitAdminRoom,
  emitBooking,
  emitDriver,
} from "../../infrastructure/realtime";
import { razorpay } from "../../integrations/razorpay";
import {
  activatePaidSubscription,
  lockSubscriptionDriver,
  subscriptionPaymentResponse,
} from "../driver/services/subscription-state";
import { NotificationsService } from "../notifications/service";

export class PaymentsService {
  private readonly notifications = new NotificationsService();
  async reconcile(paymentId: string) {
    let payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    // Recover a process crash between provider order creation and saving its ID.
    if (
      payment?.subscriptionId &&
      payment.provider === razorpay.name &&
      payment.status === "CREATED" &&
      !payment.providerOrderId &&
      payment.createdAt.getTime() < Date.now() - 120_000
    ) {
      const response = await razorpay.getOrdersByReceipt(payment.id);
      if (!Array.isArray(response.items))
        throw errors.unavailable(
          "Payment provider returned an invalid order list",
        );
      const order = (response.items as Array<Record<string, unknown>>).find(
        (item) => item.receipt === payment!.id,
      );
      const subscription = await prisma.driverSubscription.findUniqueOrThrow({
        where: { id: payment.subscriptionId },
      });
      const saved = payment;
      await prisma.$transaction(async (tx) => {
        await lockSubscriptionDriver(tx, subscription.driverId);
        if (order) {
          if (
            typeof order.id !== "string" ||
            order.amount !== saved.amount.mul(100).toNumber() ||
            order.currency !== saved.currency
          )
            throw errors.conflict("Payment order does not match subscription");
          await tx.payment.updateMany({
            where: { id: saved.id, status: "CREATED", providerOrderId: null },
            data: { providerOrderId: order.id, status: "PENDING" },
          });
        } else {
          const changed = await tx.payment.updateMany({
            where: { id: saved.id, status: "CREATED", providerOrderId: null },
            data: { status: "FAILED" },
          });
          if (changed.count === 1)
            await tx.driverSubscription.updateMany({
              where: { id: subscription.id, status: "PENDING_PAYMENT" },
              data: { status: "FAILED" },
            });
        }
      });
      payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    }
    if (
      !payment?.providerOrderId ||
      payment.status === PaymentStatus.CAPTURED
    ) {
      return;
    }
    const response = await razorpay.getOrderPayments(payment.providerOrderId);
    const items = Array.isArray(response.items)
      ? (response.items as Array<Record<string, unknown>>)
      : [];
    const captured = items.find((item) => item.status === "captured");
    if (captured && typeof captured.id === "string") {
      if (
        payment.subscriptionId &&
        (captured.order_id !== payment.providerOrderId ||
          captured.amount !== payment.amount.mul(100).toNumber() ||
          captured.currency !== payment.currency)
      ) {
        throw errors.conflict(
          "Payment amount or currency does not match subscription",
        );
      }
      await this.capture(
        payment.id,
        captured.id,
        `reconcile:${payment.id}:${captured.id}`,
      );
    }
  }

  async create(
    userId: string,
    roles: string[],
    idempotencyKey: string,
    input: { bookingId: string; method: PaymentMethod },
  ) {
    if (!idempotencyKey || idempotencyKey.length > 100) {
      throw errors.badRequest("A valid x-idempotency-key header is required");
    }
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      include: { customer: true, trip: { include: { driver: true } } },
    });
    if (!booking) throw errors.notFound("Booking not found");
    const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
    const isCustomer = booking.customer.userId === userId;
    const isAssignedDriver = booking.trip?.driver.userId === userId;
    if (
      (input.method === PaymentMethod.CASH && !isAssignedDriver && !isAdmin) ||
      (input.method !== PaymentMethod.CASH && !isCustomer && !isAdmin)
    ) {
      throw errors.forbidden("Payment access denied");
    }
    if (
      booking.status !== BookingStatus.PAYMENT_PENDING ||
      !booking.finalFare
    ) {
      throw errors.conflict("Booking is not awaiting payment");
    }

    if (input.method === PaymentMethod.CASH) {
      const payment = await prisma.$transaction(
        async (tx) => {
          const created = await tx.payment.create({
            data: {
              bookingId: booking.id,
              method: input.method,
              provider: "CASH",
              status: PaymentStatus.CAPTURED,
              amount: booking.finalFare!,
              amountPaid: booking.finalFare!,
              idempotencyKey,
              paidAt: new Date(),
              transactions: {
                create: {
                  type: "CAPTURED",
                  amount: booking.finalFare!,
                  status: "SUCCESS",
                },
              },
            },
          });
          await this.markPaid(
            tx,
            { ...created, bookingId: created.bookingId! },
            userId,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.publishPayment(payment.id, booking.id, payment.status);
      return payment;
    }

    if (input.method === PaymentMethod.WALLET) {
      if (!isCustomer) {
        throw errors.forbidden("Only the customer can use their wallet");
      }
      if (booking.finalFare.lessThanOrEqualTo(0)) {
        throw errors.badRequest("Payment amount must be greater than zero");
      }
      const payment = await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet || wallet.balance.lessThan(booking.finalFare!)) {
            throw errors.conflict("Insufficient wallet balance");
          }
          const balanceAfter = wallet.balance.sub(booking.finalFare!);
          const debited = await tx.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: {
              balance: balanceAfter,
              version: { increment: 1 },
            },
          });
          if (debited.count !== 1) {
            throw errors.conflict("Wallet changed; retry the request");
          }
          const created = await tx.payment.create({
            data: {
              bookingId: booking.id,
              method: input.method,
              provider: "WALLET",
              status: PaymentStatus.CAPTURED,
              amount: booking.finalFare!,
              amountPaid: booking.finalFare!,
              idempotencyKey,
              paidAt: new Date(),
              transactions: {
                create: {
                  type: "CAPTURED",
                  amount: booking.finalFare!,
                  status: "SUCCESS",
                },
              },
            },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: "DEBIT",
              amount: booking.finalFare!,
              balanceAfter,
              referenceType: "PAYMENT",
              referenceId: created.id,
              idempotencyKey: `payment:${idempotencyKey}`,
              description: `Payment for booking ${booking.id}`,
            },
          });
          await this.markPaid(
            tx,
            { ...created, bookingId: created.bookingId! },
            userId,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.publishPayment(payment.id, booking.id, payment.status);
      return payment;
    }

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: input.method,
        provider: razorpay.name,
        status: PaymentStatus.CREATED,
        amount: booking.finalFare,
        idempotencyKey,
      },
    });
    try {
      const order = await razorpay.createOrder({
        amountMinor: booking.finalFare.mul(100).toNumber(),
        currency: booking.currency,
        receipt: payment.id,
        notes: { bookingId: booking.id, paymentId: payment.id },
      });
      if (typeof order.id !== "string") {
        throw errors.unavailable("Payment provider returned an invalid order");
      }
      const pending = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerOrderId: order.id,
          status: PaymentStatus.PENDING,
          transactions: {
            create: {
              type: "ORDER_CREATED",
              amount: booking.finalFare,
              status:
                typeof order.status === "string" ? order.status : "CREATED",
            },
          },
        },
      });
      await this.publishPayment(pending.id, booking.id, pending.status);
      return pending;
    } catch (error) {
      const failed = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          transactions: {
            create: { type: "FAILED", status: "PROVIDER_ERROR" },
          },
        },
      });
      emitAdminRoom("dashboard", "admin:payment:failed", {
        paymentId: failed.id,
        bookingId: failed.bookingId,
        status: failed.status,
      });
      throw error;
    }
  }

  async verify(
    userId: string,
    roles: string[],
    input: {
      paymentId: string;
      providerPaymentId: string;
      signature: string;
    },
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        booking: { include: { customer: true } },
        driverSubscription: { include: { driver: true } },
      },
    });
    if (!payment?.providerOrderId) {
      throw errors.notFound("Payment order not found");
    }
    if (payment.subscriptionId) {
      if (payment.driverSubscription?.driver.userId !== userId)
        throw errors.forbidden("Payment access denied");
      if (payment.provider !== razorpay.name)
        throw errors.conflict("Subscription payment provider is not supported");
      if (
        !razorpay.verifyPayment(
          payment.providerOrderId,
          input.providerPaymentId,
          input.signature,
        )
      )
        throw errors.unauthorized("Payment signature verification failed");
      if (payment.status === PaymentStatus.CAPTURED)
        return subscriptionPaymentResponse(payment);
      // A valid checkout signature proves identity, not capture. Confirm captured funds.
      const response = await razorpay.getOrderPayments(payment.providerOrderId);
      const items = Array.isArray(response.items)
        ? (response.items as Array<Record<string, unknown>>)
        : [];
      const captured = items.find(
        (item) => item.id === input.providerPaymentId,
      );
      if (!captured || captured.status !== "captured")
        throw errors.conflict(
          "Payment is not captured yet; refresh payment status",
        );
      if (
        captured.order_id !== payment.providerOrderId ||
        captured.amount !== payment.amount.mul(100).toNumber() ||
        captured.currency !== payment.currency
      )
        throw errors.conflict(
          "Payment amount or currency does not match subscription",
        );
      return subscriptionPaymentResponse(
        await this.capture(
          payment.id,
          input.providerPaymentId,
          `client:${payment.id}`,
          userId,
        ),
      );
    }
    if (!payment.booking) {
      throw errors.notFound("Payment has no associated booking");
    }
    if (
      payment.booking.customer.userId !== userId &&
      !roles.includes("ADMIN") &&
      !roles.includes("SUPER_ADMIN")
    ) {
      throw errors.forbidden("Payment access denied");
    }
    if (payment.status === PaymentStatus.CAPTURED) {
      if (payment.bookingId) {
        await this.publishPayment(payment.id, payment.bookingId, payment.status);
      }
      return payment;
    }
    if (
      !razorpay.verifyPayment(
        payment.providerOrderId,
        input.providerPaymentId,
        input.signature,
      )
    ) {
      throw errors.unauthorized("Payment signature verification failed");
    }
    return this.capture(
      payment.id,
      input.providerPaymentId,
      `client:${payment.id}`,
      userId,
    );
  }

  async webhook(
    rawBody: Buffer,
    signature: string,
    payload: Record<string, unknown>,
    headerEventId?: string,
  ) {
    if (!razorpay.verifyWebhook(rawBody, signature)) {
      throw errors.unauthorized("Webhook signature verification failed");
    }
    const eventId =
      headerEventId ||
      (typeof payload.id === "string"
        ? payload.id
        : typeof payload.event_id === "string"
          ? payload.event_id
          : "");
    const event = typeof payload.event === "string" ? payload.event : "";
    if (!eventId) throw errors.badRequest("Webhook event ID is required");
    const duplicate = await prisma.paymentTransaction.findUnique({
      where: { providerEventId: eventId },
    });
    if (duplicate) return;
    if (event !== "payment.captured") return;
    const nested = payload.payload as Record<string, unknown> | undefined;
    const paymentWrapper = nested?.payment as
      Record<string, unknown> | undefined;
    const entity = paymentWrapper?.entity as
      Record<string, unknown> | undefined;
    const providerPaymentId = typeof entity?.id === "string" ? entity.id : "";
    const orderId = typeof entity?.order_id === "string" ? entity.order_id : "";
    if (!providerPaymentId || !orderId) {
      throw errors.badRequest("Webhook payment payload is invalid");
    }
    const payment = await prisma.payment.findUnique({
      where: { providerOrderId: orderId },
    });
    if (!payment) throw errors.notFound("Webhook payment not found");

    const webhookAmountMinor =
      typeof entity?.amount === "number" ? entity.amount : 0;
    const webhookCurrency =
      typeof entity?.currency === "string" ? entity.currency : "";
    const expectedAmountMinor = payment.amount.mul(100).toNumber();

    if (
      webhookAmountMinor !== expectedAmountMinor ||
      webhookCurrency !== payment.currency
    ) {
      // Create a FAILED transaction for auditing the mismatch, but don't transition payment status
      await prisma.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          type: "WEBHOOK",
          providerEventId: eventId,
          status: "FAILED",
          errorCode: "AMOUNT_MISMATCH",
        },
      });
      return;
    }

    await this.capture(payment.id, providerPaymentId, eventId);
  }

  private async capture(
    paymentId: string,
    providerPaymentId: string,
    eventId: string,
    actorUserId?: string,
  ) {
    const target = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { subscriptionId: true },
    });
    const result = await prisma.$transaction(
      async (tx) => {
        const initial = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { driverSubscription: true },
        });
        if (initial.driverSubscription)
          await lockSubscriptionDriver(tx, initial.driverSubscription.driverId);
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
        });
        if (payment.status === PaymentStatus.CAPTURED) return payment;
        const changed = await tx.payment.updateMany({
          where: {
            id: paymentId,
            status: {
              in: [
                PaymentStatus.CREATED,
                PaymentStatus.PENDING,
                PaymentStatus.AUTHORIZED,
              ],
            },
          },
          data: {
            status: PaymentStatus.CAPTURED,
            providerPaymentId,
            amountPaid: payment.amount,
            paidAt: new Date(),
          },
        });
        if (changed.count !== 1)
          throw errors.conflict("Payment cannot be captured");
        await tx.paymentTransaction.create({
          data: {
            paymentId,
            type: "CAPTURED",
            providerEventId: eventId,
            amount: payment.amount,
            status: "SUCCESS",
          },
        });
        if (payment.subscriptionId) {
          const metadata = payment.metadata as { durationDays?: number } | null;
          if (!metadata?.durationDays)
            throw errors.conflict(
              "Subscription payment has no duration snapshot",
            );
          await activatePaidSubscription(
            tx,
            payment.subscriptionId,
            metadata.durationDays,
          );
        } else {
          await this.markPaid(
            tx,
            { ...payment, bookingId: payment.bookingId! },
            actorUserId,
          );
        }
        return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      },
      {
        isolationLevel: target.subscriptionId
          ? Prisma.TransactionIsolationLevel.ReadCommitted
          : Prisma.TransactionIsolationLevel.Serializable,
      },
    );
    if (result.bookingId) {
      await this.publishPayment(result.id, result.bookingId, result.status);
    }
    return result;
  }

  private async markPaid(
    tx: Prisma.TransactionClient,
    payment: { id: string; bookingId: string },
    actorUserId?: string,
  ) {
    const paymentRecord = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { method: true, amountPaid: true },
    });
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: payment.bookingId },
      include: {
        trip: {
          include: { fareBreakdown: true, driverEarning: true },
        },
      },
    });
    const changed = await tx.booking.updateMany({
      where: {
        id: payment.bookingId,
        status: BookingStatus.PAYMENT_PENDING,
      },
      data: {
        status: BookingStatus.PAYMENT_COMPLETED,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw errors.conflict("Booking payment state changed");
    }
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: payment.bookingId,
        fromStatus: BookingStatus.PAYMENT_PENDING,
        toStatus: BookingStatus.PAYMENT_COMPLETED,
        actorUserId,
      },
    });

    const referral = await tx.referral.findUnique({
      where: { referredCustomerId: booking.customerId },
      include: { referrer: true },
    });

    if (referral && !referral.qualifiedAt) {
      const REWARD_AMOUNT = new Prisma.Decimal(50);
      const idempotencyKey = `referral:${referral.id}:reward`;

      const existingReward = await tx.referralReward.findUnique({
        where: {
          referralId_userId: {
            referralId: referral.id,
            userId: referral.referrer.userId,
          },
        },
      });

      if (!existingReward) {
        await tx.referralReward.create({
          data: {
            referralId: referral.id,
            userId: referral.referrer.userId,
            amount: REWARD_AMOUNT,
            creditedAt: new Date(),
          },
        });

        await tx.referral.update({
          where: { id: referral.id },
          data: { qualifiedAt: new Date() },
        });

        const referrerWallet = await tx.wallet.upsert({
          where: { userId: referral.referrer.userId },
          create: { userId: referral.referrer.userId, balance: 0 },
          update: {},
        });

        const balanceAfter = referrerWallet.balance.add(REWARD_AMOUNT);
        const updatedWallet = await tx.wallet.updateMany({
          where: { id: referrerWallet.id, version: referrerWallet.version },
          data: { balance: balanceAfter, version: { increment: 1 } },
        });

        if (updatedWallet.count === 1) {
          await tx.walletTransaction.create({
            data: {
              walletId: referrerWallet.id,
              type: "CREDIT",
              amount: REWARD_AMOUNT,
              balanceAfter,
              referenceType: "REFERRAL_REWARD",
              referenceId: referral.id,
              idempotencyKey,
              description: `Referral reward for user completing first trip`,
            },
          });
        }
      }
    }
    if (booking.trip?.fareBreakdown) {
      await tx.invoice.upsert({
        where: { tripId: booking.trip.id },
        update: { paymentId: payment.id },
        create: {
          tripId: booking.trip.id,
          paymentId: payment.id,
          invoiceNumber: `INV-${Date.now()}-${booking.id.slice(0, 8).toUpperCase()}`,
          subtotal: booking.trip.fareBreakdown.subtotal,
          tax: booking.trip.fareBreakdown.tax,
          total: booking.trip.fareBreakdown.total,
          currency: booking.currency,
        },
      });
    }
    if (
      paymentRecord.method !== PaymentMethod.CASH &&
      booking.trip?.driverEarning
    ) {
      const earning = booking.trip.driverEarning;
      const wallet = await tx.driverWallet.upsert({
        where: { driverId: earning.driverId },
        update: {},
        create: { driverId: earning.driverId, balance: 0 },
      });
      const existingCredit = await tx.driverWalletTransaction.findFirst({
        where: {
          walletId: wallet.id,
          referenceType: "TRIP_EARNING",
          referenceId: earning.id,
        },
      });
      if (!existingCredit) {
        const balanceAfter = wallet.balance.add(earning.netEarning);
        await tx.driverWallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });
        await tx.driverWalletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "CREDIT",
            amount: earning.netEarning,
            balanceAfter,
            referenceType: "TRIP_EARNING",
            referenceId: earning.id,
            description: `Online earning for trip ${booking.trip.id}`,
          },
        });
        await tx.driverEarning.update({
          where: { id: earning.id },
          data: {
            onlineCollected: paymentRecord.amountPaid,
            status: "AVAILABLE_FOR_PAYOUT",
          },
        });
      }
    }
  }

  async processRefund(refundId: string) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: {
          include: {
            refunds: true,
            booking: { include: { customer: true } },
          },
        },
      },
    });
    if (!refund) throw errors.notFound("Refund not found");
    if (refund.status !== "REQUESTED") {
      throw errors.conflict("Refund is not in requested state");
    }

    const existingRefunds = refund.payment.refunds.filter(
      (r) =>
        r.status === "COMPLETED" ||
        r.status === "PROCESSING" ||
        r.id === refundId,
    );
    let totalRefunded = new Prisma.Decimal(0);
    for (const r of existingRefunds) {
      if (r.id !== refundId) {
        totalRefunded = totalRefunded.add(r.amount);
      }
    }
    if (
      totalRefunded.add(refund.amount).greaterThan(refund.payment.amountPaid)
    ) {
      await prisma.refund.update({
        where: { id: refundId },
        data: {
          status: "FAILED",
          reason: "Refund amount exceeds total paid amount",
        },
      });
      return;
    }

    await prisma.refund.update({
      where: { id: refundId },
      data: { status: "PROCESSING" },
    });

    if (refund.payment.method === PaymentMethod.WALLET) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const userId = refund.payment.booking?.customer.userId;
            if (!userId)
              throw new Error("Could not determine user for wallet refund");

            const wallet = await tx.wallet.findUniqueOrThrow({
              where: { userId },
            });
            const balanceAfter = wallet.balance.add(refund.amount);

            const updated = await tx.wallet.updateMany({
              where: { id: wallet.id, version: wallet.version },
              data: { balance: balanceAfter, version: { increment: 1 } },
            });
            if (updated.count !== 1)
              throw new Error("Wallet concurrency error");

            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: "CREDIT",
                amount: refund.amount,
                balanceAfter,
                referenceType: "REFUND",
                referenceId: refund.id,
                idempotencyKey: `refund:${refund.id}`,
                description: `Refund for payment ${refund.paymentId}`,
              },
            });

            await tx.refund.update({
              where: { id: refundId },
              data: { status: "COMPLETED" },
            });

            await tx.payment.update({
              where: { id: refund.paymentId },
              data: {
                status: PaymentStatus.REFUNDED,
                transactions: {
                  create: {
                    type: "REFUND",
                    amount: refund.amount,
                    status: "COMPLETED",
                  },
                },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        await prisma.refund.update({
          where: { id: refundId },
          data: {
            status: "FAILED",
            reason:
              error instanceof Error ? error.message : "Wallet refund failed",
          },
        });
      }
      return;
    }

    if (
      refund.payment.provider !== razorpay.name ||
      !refund.payment.providerPaymentId
    ) {
      await prisma.refund.update({
        where: { id: refundId },
        data: {
          status: "FAILED",
          reason:
            "Payment provider not supported for refund or missing provider payment ID",
        },
      });
      return;
    }

    try {
      const response = await razorpay.createRefund({
        paymentId: refund.payment.providerPaymentId,
        amountMinor: refund.amount.mul(100).toNumber(),
        receipt: refund.id,
        notes: { refundId: refund.id, paymentId: refund.paymentId },
      });

      await prisma.refund.update({
        where: { id: refundId },
        data: {
          status: "COMPLETED",
          providerRefundId: String(response.id),
        },
      });

      await prisma.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: PaymentStatus.REFUNDED,
          transactions: {
            create: {
              type: "REFUND",
              amount: refund.amount,
              status: "COMPLETED",
            },
          },
        },
      });
    } catch (error) {
      await prisma.refund.update({
        where: { id: refundId },
        data: { status: "FAILED" },
      });
      throw error;
    }
  }

  private async publishPayment(
    paymentId: string,
    bookingId: string,
    status: PaymentStatus,
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        assignedDriverId: true,
        customer: { select: { userId: true } },
        trip: { select: { id: true, driverId: true } },
      },
    });
    const payload = {
      bookingId,
      tripId: booking?.trip?.id ?? null,
      paymentId,
      status,
      paymentStatus: status,
      bookingStatus: booking?.status ?? null,
    };
    emitBooking(bookingId, "payment:updated", {
      ...payload,
    });
    if (status === PaymentStatus.PENDING || status === PaymentStatus.CREATED) {
      emitBooking(bookingId, "payment:pending", {
        ...payload,
      });
    } else if (status === PaymentStatus.CAPTURED) {
      const completedPayload = {
        ...payload,
        paymentStatus: PaymentStatus.CAPTURED,
        bookingStatus: BookingStatus.PAYMENT_COMPLETED,
      };
      emitBooking(bookingId, "payment:completed", completedPayload);
      emitBooking(bookingId, "booking:payment:confirmed", completedPayload);
      emitBooking(bookingId, "booking:completed", completedPayload);
      emitBooking(bookingId, "booking:session:closed", completedPayload);
      emitBooking(bookingId, "PAYMENT_COMPLETED", completedPayload);

      const driverId = booking?.trip?.driverId ?? booking?.assignedDriverId;
      if (driverId) {
        emitDriver(driverId, "payment:completed", completedPayload);
        emitDriver(driverId, "booking:payment:confirmed", completedPayload);
        emitDriver(driverId, "booking:completed", completedPayload);
        emitDriver(driverId, "booking:session:closed", completedPayload);
        emitDriver(driverId, "PAYMENT_COMPLETED", completedPayload);
        emitDriver(driverId, "PAYMENT_CONFIRMED", completedPayload);
      }
    } else if (status === PaymentStatus.FAILED) {
      emitBooking(bookingId, "payment:failed", {
        ...payload,
      });
    }
    emitAdminRoom("dashboard", "admin:payment:updated", {
      ...payload,
    });
    if (booking) {
      await this.notifications.enqueue({
        userId: booking.customer.userId,
        bookingId,
        channel: "PUSH",
        templateKey: "PAYMENT_UPDATED",
        title: "Payment update",
        body: `Payment status: ${status.toLowerCase()}.`,
        data: {
          event: "payment:updated",
          bookingId,
          paymentId,
          status,
        },
      });

      if (status === PaymentStatus.CAPTURED && booking.trip) {
        emitBooking(bookingId, "booking:show-rating", {
          bookingId,
          tripId: booking.trip.id,
        });
        const trip = await prisma.trip.findUnique({
          where: { id: booking.trip.id },
          select: {
            driverId: true,
            driverEarning: { select: { netEarning: true } },
          },
        });
        if (trip?.driverEarning) {
          emitDriver(trip.driverId, "earnings:credited", {
            bookingId,
            tripId: booking.trip.id,
            amount: trip.driverEarning.netEarning,
          });
        }
      }
    }
  }
}
