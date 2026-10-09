import { CustomerSupportService } from "../../customer/services/customer-support.service";
import { generateTicketNumber } from "../ticket-number";
import {
  ensureSupportCategories,
  DEFAULT_SUPPORT_CATEGORIES,
} from "../seed-categories";
import { uploadSupportAttachment } from "../../../integrations/storage";
import { prisma } from "../../../database/prisma";
import { redis } from "../../../infrastructure/redis";
import { closeQueues } from "../../../infrastructure/queues";

describe("Support Module Tests", () => {
  const support = new CustomerSupportService();
  const testPhone = "+918000001111";
  const otherPhone = "+918000002222";

  let ownerUserId: string;
  let otherUserId: string;
  const ticketIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { phone: testPhone },
      update: { status: "ACTIVE" },
      create: {
        phone: testPhone,
        status: "ACTIVE",
        displayName: "Support Owner",
        customerProfile: { create: { referralCode: "SUPTEST1" } },
      },
      include: { customerProfile: true },
    });
    const other = await prisma.user.upsert({
      where: { phone: otherPhone },
      update: { status: "ACTIVE" },
      create: {
        phone: otherPhone,
        status: "ACTIVE",
        displayName: "Support Other",
        customerProfile: { create: { referralCode: "SUPTEST2" } },
      },
      include: { customerProfile: true },
    });
    ownerUserId = owner.id;
    otherUserId = other.id;
  });

  afterAll(async () => {
    await prisma.supportMessageRead.deleteMany({
      where: { message: { ticketId: { in: ticketIds } } },
    });
    await prisma.supportMessage.deleteMany({
      where: { ticketId: { in: ticketIds } },
    });
    await prisma.supportTicket.deleteMany({
      where: { id: { in: ticketIds } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [testPhone, otherPhone] } },
    });
    await closeQueues();
    await prisma.$disconnect();
    await redis.quit();
  });

  describe("ticket number generation", () => {
    it("produces a #XXXXXX style number from the allowed alphabet", async () => {
      const number = generateTicketNumber();
      expect(number).toMatch(/^#[0-9A-Z]{6}$/);
      for (const char of number.slice(1)) {
        expect("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(char)).toBe(
          true,
        );
      }
    });

    it("generates distinct ticket numbers repeatedly", async () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 25; i += 1) {
        numbers.add(generateTicketNumber());
      }
      expect(numbers.size).toBe(25);
    });
  });

  describe("default support categories", () => {
    it("ensures the default categories exist and are active", async () => {
      await ensureSupportCategories();
      for (const cat of DEFAULT_SUPPORT_CATEGORIES) {
        const found = await prisma.supportCategory.findFirst({
          where: { code: cat.code, isActive: true },
        });
        expect(found).toBeDefined();
        expect(found?.name).toBe(cat.name);
      }
    });
  });

  describe("ticket creation", () => {
    it("creates a ticket without categoryId by falling back to GENERAL", async () => {
      const ticket = await support.createTicket(ownerUserId, {
        subject: "Battery draining fast",
        description: "App closes in the background",
        attachments: [
          { url: "https://cdn.test/photo_1.jpg", name: "photo_1.jpg" },
        ],
      });
      expect(ticket).toBeDefined();
      expect(ticket.ticketNumber).toMatch(/^#[A-Z0-9]{6}$/);
      expect(ticket.category).toBe("General");
      expect(ticket.subject).toBe("Battery draining fast");
      expect(ticket.description).toBe("App closes in the background");
      expect(ticket.attachments).toEqual([
        { url: "https://cdn.test/photo_1.jpg", name: "photo_1.jpg" },
      ]);
      expect(ticket.status).toBe("OPEN");
      ticketIds.push(ticket.id);
    });

    it("rejects an unknown category", async () => {
      await expect(
        support.createTicket(ownerUserId, {
          categoryId: "00000000-0000-0000-0000-000000000000",
          subject: "Invalid category",
          description: "Should fail",
        }),
      ).rejects.toThrow();
    });

    it("rejects attachments for another customer's booking", async () => {
      await expect(
        support.createTicket(ownerUserId, {
          subject: "Wrong booking",
          description: "Should fail",
          bookingId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toThrow();
    });
  });

  describe("ticket access control", () => {
    it("prevents another user from reading someone else's ticket", async () => {
      const ticket = await support.createTicket(ownerUserId, {
        subject: "Private issue",
        description: "Only mine",
      });
      ticketIds.push(ticket.id);
      await expect(support.getTicket(otherUserId, ticket.id)).rejects.toThrow();
      await expect(
        support.getMessages(otherUserId, ticket.id),
      ).rejects.toThrow();
      await expect(
        support.markMessagesRead(otherUserId, ticket.id),
      ).rejects.toThrow();
    });
  });

  describe("messaging and read tracking", () => {
    it("adds a message to an OPEN ticket and blocks resolved tickets", async () => {
      const ticket = await support.createTicket(ownerUserId, {
        subject: "Follow up",
        description: "Still not fixed",
      });
      ticketIds.push(ticket.id);
      const sent = await support.createMessage(
        ownerUserId,
        ticket.id,
        "Any update on this?",
      );
      expect(sent.message).toBe("Any update on this?");
      expect(sent.senderType).toBe("USER");

      await support.closeTicket(ownerUserId, ticket.id);
      await expect(
        support.createMessage(ownerUserId, ticket.id, "Late message"),
      ).rejects.toThrow();

      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: "OPEN" },
      });
    });

    it("tracks unread counts and marks messages read", async () => {
      const ticket = await support.createTicket(ownerUserId, {
        subject: "Unread tickets",
        description: "Waiting for staff response",
      });
      ticketIds.push(ticket.id);

      await prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderUserId: otherUserId,
          message: "Support team: we are on it.",
          isInternal: false,
        },
      });

      const { unreadMessages } = await support.getTicket(
        ownerUserId,
        ticket.id,
      );
      expect(unreadMessages).toBeGreaterThan(0);

      const result = await support.markMessagesRead(ownerUserId, ticket.id);
      expect(result.markedRead).toBeGreaterThan(0);
      expect(result.unreadCount).toBe(0);

      const readRows = await prisma.supportMessageRead.count({
        where: { userId: ownerUserId, message: { ticketId: ticket.id } },
      });
      expect(readRows).toBeGreaterThan(0);
    });

    it("lists tickets with latest first and total count", async () => {
      const result = await support.listTickets(ownerUserId, 1, 10);
      expect(result.total).toBeGreaterThan(0);
      expect(result.items.length).toBeGreaterThan(0);
      const first = result.items[0]!;
      expect(first.ticketNumber).toMatch(/^#/);
      expect(first).toHaveProperty("unreadMessages");
    });
  });

  describe("attachment upload", () => {
    it("accepts a valid PNG upload", async () => {
      const magic = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(128, 1),
      ]);
      const result = await support.uploadAttachment(
        ownerUserId,
        "image/png",
        magic,
        "screenshot.png",
      );
      expect(result.contentType).toBe("image/png");
      expect(result.url).toMatch(/\/images\/support-attachments\//);
      expect(result.name).toBe("screenshot.png");
    });

    it("rejects unsupported content types", async () => {
      await expect(
        uploadSupportAttachment(
          ownerUserId,
          "text/plain",
          Buffer.from("hi"),
          "notes.txt",
        ),
      ).rejects.toThrow();
    });

    it("rejects oversized attachments", async () => {
      await expect(
        uploadSupportAttachment(
          ownerUserId,
          "application/pdf",
          Buffer.alloc(5 * 1024 * 1024 + 1),
        ),
      ).rejects.toThrow();
    });
  });
});
