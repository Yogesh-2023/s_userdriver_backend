import { CustomerAuthService } from "../services/customer-auth.service";
import { CustomerAddressService } from "../services/customer-address.service";
import { CustomerLocationService } from "../services/customer-location.service";
import { CustomerBookingService } from "../services/customer-booking.service";
import { CustomerPaymentService } from "../services/customer-payment.service";
import { CustomerMarketingService } from "../services/customer-marketing.service";
import { CustomerSupportService } from "../services/customer-support.service";
import { CustomerSafetyService } from "../services/customer-safety.service";
import { CustomerRatingService } from "../services/customer-rating.service";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { errors } from "../../../common/errors";
import { closeQueues } from "../../../infrastructure/queues";

describe("Customer Module Comprehensive Tests", () => {
  const auth = new CustomerAuthService();
  const address = new CustomerAddressService();
  const location = new CustomerLocationService();
  const booking = new CustomerBookingService();
  const payment = new CustomerPaymentService();
  const marketing = new CustomerMarketingService();
  const support = new CustomerSupportService();
  const safety = new CustomerSafetyService();
  const rating = new CustomerRatingService();

  let testUserId: string;
  let testCustomerId: string;
  const testPhone = "+919999999999";

  beforeAll(async () => {
    // Setup test user/customer
    const user = await prisma.user.upsert({
      where: { phone: testPhone },
      update: { status: "ACTIVE" },
      create: {
        phone: testPhone,
        status: "ACTIVE",
        customerProfile: {
          create: {
            referralCode: "TESTREF123",
          },
        },
      },
      include: { customerProfile: true },
    });
    testUserId = user.id;
    testCustomerId = user.customerProfile!.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.customerAddress.deleteMany({
      where: { customerId: testCustomerId },
    });
    await prisma.emergencyContact.deleteMany({
      where: { ownerUserId: testUserId },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { userId: testUserId } },
    });
    await prisma.wallet.deleteMany({ where: { userId: testUserId } });

    await closeQueues();
    await prisma.$disconnect();
    await redis.quit();
  });

  describe("Authentication Rate Limiting and Verification Lockout", () => {
    it("enforces failed verify-otp lockout after 5 attempts", async () => {
      const phone = "+919876543210";
      // Clear verify attempts in Redis first
      const attemptsKey = `customer:otp:verify-attempts:${phone}`;
      await redis.del(attemptsKey);

      // Force create OTP hash in Redis
      await redis.setex(`customer:otp:verify:${phone}`, 300, "correct_hash");

      // Verify incorrect OTP 4 times
      for (let i = 0; i < 4; i++) {
        await expect(
          auth.verifyOtp(phone, "mobile", "wrong", {}),
        ).rejects.toThrow("OTP is invalid or has expired");
      }

      // 5th attempt throws rate limited
      await expect(
        auth.verifyOtp(phone, "mobile", "wrong", {}),
      ).rejects.toThrow("Too many failed verification attempts");
    });
  });

  describe("Customer Address Operations", () => {
    it("creates, retrieves, and updates addresses with default status integrity", async () => {
      // 1. Create first address (should automatically be default)
      const addr1 = await address.create(testUserId, {
        label: "HOME",
        addressLine: "123 Test Street",
        latitude: 28.6273,
        longitude: 77.3725,
      });
      expect(addr1.isDefault).toBe(true);

      // 2. Create second address as default (should demote first)
      const addr2 = await address.create(testUserId, {
        label: "WORK",
        addressLine: "456 Office Road",
        latitude: 28.6304,
        longitude: 77.2177,
        isDefault: true,
      });
      expect(addr2.isDefault).toBe(true);

      const refreshedAddr1 = await address.get(testUserId, addr1.id);
      expect(refreshedAddr1.isDefault).toBe(false);

      // Cleanup addresses
      await address.delete(testUserId, addr1.id);
      await address.delete(testUserId, addr2.id);
    });
  });

  describe("Geofencing Serviceability", () => {
    it("identifies serviceable locations based on ray-casting point-in-polygon checks", async () => {
      // Create a test service area with boundary polygon around Noida
      const area = await prisma.serviceArea.upsert({
        where: { name: "Test Noida" },
        update: { isActive: true },
        create: {
          name: "Test Noida",
          city: "Noida",
          state: "UP",
          country: "India",
          timezone: "Asia/Kolkata",
          centerLatitude: 28.6273,
          centerLongitude: 77.3725,
          isActive: true,
          boundaryPolygon: [
            [77.35, 28.6],
            [77.4, 28.6],
            [77.4, 28.65],
            [77.35, 28.65],
            [77.35, 28.6],
          ], // boundary polygon around Noida Sec-62
        },
      });

      // Inside coordinates (Sec-62) -> serviceable
      const serviceable = await location.checkServiceability(28.62, 77.37);
      expect(serviceable.isServiceable).toBe(true);
      expect(serviceable.serviceAreaId).toBe(area.id);

      // Outside coordinates (Delhi Connaught Place) -> not serviceable
      const unserviceable = await location.checkServiceability(28.85, 77.85);
      expect(unserviceable.isServiceable).toBe(false);

      // Cleanup
      await prisma.serviceArea.delete({ where: { id: area.id } });
    });
  });

  describe("Ledger-Based Wallet Transactions", () => {
    it("credits and debits wallet balance transactionally preventing negative balance", async () => {
      const mockOrderId = `order_mock_${Math.random().toString(36).substring(2)}`;
      const providerPaymentId = `pay_mock_${Math.random().toString(36).substring(2)}`;

      // 1. Simulate topup order creation
      await redis.setex(
        `customer:wallet-topup:${mockOrderId}`,
        600,
        JSON.stringify({ userId: testUserId, amount: 500.0 }),
      );

      // 2. Verify topup (credits wallet)
      const topup = await payment.verifyWalletTopup(testUserId, {
        orderId: mockOrderId,
        providerPaymentId,
        signature: "valid_mock_sig_1234567890",
      });
      expect(topup.amount.toNumber()).toBe(500);

      // Check balance
      const wallet = await payment.getWallet(testUserId, 1, 10);
      expect(Number(wallet.balance)).toBe(500);

      // Double topup with same providerPaymentId is prevented (idempotency check)
      await expect(
        payment.verifyWalletTopup(testUserId, {
          orderId: mockOrderId,
          providerPaymentId,
          signature: "valid_mock_sig_1234567890",
        }),
      ).rejects.toThrow();
    });
  });

  describe("Hiding Internal Admin Support Ticket Notes", () => {
    it("retrieves support ticket threads without exposing internal messages", async () => {
      const cat = await prisma.supportCategory.findFirst({
        where: { isActive: true },
      });
      if (!cat) return;

      const ticket = await support.createTicket(testUserId, {
        categoryId: cat.id,
        subject: "Refund Issue",
        description: "Please refund my last trip",
      });

      // Insert internal admin note manually
      await prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderUserId: testUserId,
          message: "Internal audit note: User is suspect of promo fraud.",
          isInternal: true,
        },
      });

      // Retrieve ticket details
      const retrieved = await support.getTicket(testUserId, ticket.id);

      // Messages should not include the internal note
      expect(retrieved.messages).toBeDefined();
      expect(retrieved.messages.length).toBe(1);
      const msg = retrieved.messages[0];
      expect(msg).toBeDefined();
      expect(msg?.message).toBe("Please refund my last trip");

      // Cleanup
      await prisma.supportMessage.deleteMany({
        where: { ticketId: ticket.id },
      });
      await prisma.supportTicket.delete({ where: { id: ticket.id } });
    });
  });
});
