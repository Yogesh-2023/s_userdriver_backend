import { Prisma, PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { errors } from "../../../common/errors";
import { razorpay } from "../../../integrations/razorpay";
import { PaymentsService } from "../../payments/service";

export class CustomerPaymentService {
  private readonly payments = new PaymentsService();

  async getPaymentOptions(userId: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw errors.notFound("Booking not found");

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    const walletBalance = wallet ? Number(wallet.balance) : 0;

    const options: any[] = [
      {
        method: "CASH",
        label: "Cash Payment",
        icon: "cash-icon",
        available: true,
      },
      {
        method: "UPI",
        label: "UPI (Google Pay, PhonePe)",
        icon: "upi-icon",
        available: true,
      },
      {
        method: "CREDIT_CARD",
        label: "Credit / Debit Card",
        icon: "card-icon",
        available: true,
      },
      {
        method: "NET_BANKING",
        label: "Net Banking",
        icon: "bank-icon",
        available: true,
      },
    ];

    const fare = Number(booking.finalFare ?? booking.estimatedFare);
    options.push({
      method: "WALLET",
      label: `Wallet (Bal: ₹${walletBalance.toFixed(2)})`,
      icon: "wallet-icon",
      available: walletBalance >= fare,
      balance: walletBalance,
    });

    return options;
  }

  async changePaymentMethod(
    userId: string,
    bookingId: string,
    paymentMethod: any,
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });
    if (!booking || booking.customer.userId !== userId) {
      throw errors.notFound("Booking not found");
    }
    if (booking.status !== "PAYMENT_PENDING") {
      throw errors.conflict(
        "Payment method can only be changed when payment is pending",
      );
    }

    // Change payment method logic
    // Payments are normally created inside `/payments` using the chosen method.
    // If there is an existing payment that is PENDING/CREATED, we can mark it as CANCELLED or FAILED.
    await prisma.payment.updateMany({
      where: {
        bookingId,
        status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
      },
      data: { status: PaymentStatus.FAILED },
    });

    return { success: true };
  }

  async createBookingOrder(
    userId: string,
    bookingId: string,
    method: PaymentMethod,
    idempotencyKey: string,
  ) {
    // Simply delegates to the existing PaymentsService
    return this.payments.create(userId, ["CUSTOMER"], idempotencyKey, {
      bookingId,
      method,
    });
  }

  async verifyBookingPayment(userId: string, input: any) {
    // Simply delegates to the existing PaymentsService
    return this.payments.verify(userId, ["CUSTOMER"], input);
  }

  async addWalletMoney(userId: string, amount: number, paymentMethod: string) {
    if (amount <= 0) throw errors.badRequest("Amount must be positive");
    if (!razorpay.name) {
      // Mock order creation for testing if gateway not available
      const mockOrderId = `order_mock_${Math.random().toString(36).substring(2)}`;
      await redis.setex(
        `customer:wallet-topup:${mockOrderId}`,
        600,
        JSON.stringify({ userId, amount }),
      );
      return {
        id: mockOrderId,
        amount: amount * 100,
        currency: "INR",
        receipt: `receipt_mock_${Date.now()}`,
        mock: true,
      };
    }

    const receipt = `topup_${userId.substring(0, 8)}_${Date.now()}`;
    const order = await razorpay.createOrder({
      amountMinor: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: { userId, type: "WALLET_TOPUP" },
    });

    if (typeof order.id !== "string") {
      throw errors.unavailable("Payment provider failed to generate order");
    }

    // Cache the topup context in Redis to resolve it on verify
    await redis.setex(
      `customer:wallet-topup:${order.id}`,
      600, // 10 minutes
      JSON.stringify({ userId, amount }),
    );

    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    };
  }

  async verifyWalletTopup(
    userId: string,
    input: { orderId: string; providerPaymentId: string; signature: string },
  ) {
    const cached = await redis.get(`customer:wallet-topup:${input.orderId}`);
    if (!cached)
      throw errors.notFound("Wallet topup order expired or not found");

    const { userId: ownerId, amount } = JSON.parse(cached);
    if (ownerId !== userId) throw errors.forbidden("Payment access denied");

    // Skip actual Razorpay verification for mock orders in testing/dev
    if (!input.orderId.startsWith("order_mock_")) {
      const verified = razorpay.verifyPayment(
        input.orderId,
        input.providerPaymentId,
        input.signature,
      );
      if (!verified)
        throw errors.unauthorized("Payment signature verification failed");
    }

    const money = new Prisma.Decimal(amount);
    const result = await prisma.$transaction(async (tx) => {
      // Check idempotency for wallet topup transaction
      const replay = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: `topup:${input.providerPaymentId}` },
      });
      if (replay) return replay;

      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      const nextBalance = wallet.balance.add(money);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: nextBalance, version: { increment: 1 } },
      });

      const txRecord = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT",
          amount: money,
          balanceAfter: nextBalance,
          referenceType: "WALLET_TOPUP",
          referenceId: input.providerPaymentId,
          idempotencyKey: `topup:${input.providerPaymentId}`,
          description: `Topup via ${input.providerPaymentId}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorRole: "CUSTOMER",
          action: "CUSTOMER_WALLET_CREDITED",
          entityType: "WalletTransaction",
          entityId: txRecord.id,
          metadata: { amount, balanceAfter: nextBalance },
        },
      });

      return txRecord;
    });

    await redis.del(`customer:wallet-topup:${input.orderId}`);
    return result;
  }

  async getWallet(userId: string, page: number, limit: number) {
    const wallet = await prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const [transactions, total] = await prisma.$transaction([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      balance: wallet.balance,
      transactions,
      meta: { page, limit, total },
    };
  }
}
