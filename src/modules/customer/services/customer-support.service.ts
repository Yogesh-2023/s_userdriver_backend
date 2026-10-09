import type { SupportPriority } from "@prisma/client";
import { SupportService, type TicketAttachment } from "../../support/service";

const support = new SupportService();

export class CustomerSupportService {
  listCategories() {
    return support.listCategories();
  }

  createTicket(
    userId: string,
    input: {
      categoryId?: string;
      subject: string;
      description: string;
      bookingId?: string;
      tripId?: string;
      paymentId?: string;
      priority?: SupportPriority;
      attachments?: TicketAttachment | TicketAttachment[] | string | null;
    },
  ) {
    return support.create(userId, {
      categoryId: input.categoryId,
      subject: input.subject,
      description: input.description,
      bookingId: input.bookingId,
      tripId: input.tripId,
      paymentId: input.paymentId,
      priority: input.priority,
      attachments: input.attachments,
    });
  }

  listTickets(userId: string, page?: number, limit?: number) {
    return support.list(userId, page ?? 1, limit ?? 20);
  }

  getTicket(userId: string, ticketId: string) {
    return support.get(ticketId, userId);
  }

  getMessages(userId: string, ticketId: string) {
    return support.getMessages(userId, ticketId);
  }

  createMessage(
    userId: string,
    ticketId: string,
    message: string,
    attachments?: TicketAttachment | TicketAttachment[] | string | null,
  ) {
    return support.createMessage(userId, ticketId, message, attachments);
  }

  markMessagesRead(userId: string, ticketId: string) {
    return support.markMessagesRead(userId, ticketId);
  }

  uploadAttachment(
    userId: string,
    contentType: string,
    body: Buffer,
    filename?: string,
  ) {
    return support.uploadAttachment(userId, contentType, body, filename);
  }

  closeTicket(userId: string, ticketId: string) {
    return support.closeTicket(userId, ticketId);
  }
}
