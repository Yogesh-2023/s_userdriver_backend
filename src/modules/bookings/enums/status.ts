import { BookingStatus } from "@prisma/client";

export const bookingTransitions: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  PENDING: [BookingStatus.SEARCHING_DRIVER, BookingStatus.CANCELLED],
  SEARCHING_DRIVER: [
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.NO_DRIVER_FOUND,
    BookingStatus.CANCELLED,
  ],
  DRIVER_ASSIGNED: [
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.SEARCHING_DRIVER,
    BookingStatus.CANCELLED,
  ],
  DRIVER_ARRIVING: [
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.SEARCHING_DRIVER,
    BookingStatus.CANCELLED,
  ],
  DRIVER_ARRIVED: [
    BookingStatus.TRIP_STARTED,
    BookingStatus.SEARCHING_DRIVER,
    BookingStatus.CANCELLED,
  ],
  TRIP_STARTED: [BookingStatus.TRIP_COMPLETED, BookingStatus.CANCELLED],
  TRIP_COMPLETED: [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.PAYMENT_COMPLETED,
    BookingStatus.CANCELLED,
  ],
  PAYMENT_PENDING: [
    BookingStatus.PAYMENT_COMPLETED,
    BookingStatus.CANCELLED,
  ],
  PAYMENT_COMPLETED: [],
  CANCELLED: [],
  NO_DRIVER_FOUND: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus) =>
  bookingTransitions[from].includes(to);
