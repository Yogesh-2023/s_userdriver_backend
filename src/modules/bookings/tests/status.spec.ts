import { BookingStatus } from "@prisma/client";
import { bookingTransitions, canTransition } from "../enums/status";

describe("booking state machine", () => {
  it("allows the complete successful lifecycle", () => {
    const states = [
      BookingStatus.PENDING,
      BookingStatus.SEARCHING_DRIVER,
      BookingStatus.DRIVER_ASSIGNED,
      BookingStatus.DRIVER_ARRIVING,
      BookingStatus.DRIVER_ARRIVED,
      BookingStatus.TRIP_STARTED,
      BookingStatus.TRIP_COMPLETED,
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.PAYMENT_COMPLETED,
    ];
    for (let index = 0; index < states.length - 1; index += 1) {
      expect(canTransition(states[index]!, states[index + 1]!)).toBe(true);
    }
  });

  it.each([
    [BookingStatus.PENDING, BookingStatus.TRIP_STARTED],
    [BookingStatus.TRIP_STARTED, BookingStatus.CANCELLED],
    [BookingStatus.PAYMENT_COMPLETED, BookingStatus.PAYMENT_PENDING],
    [BookingStatus.CANCELLED, BookingStatus.SEARCHING_DRIVER],
  ])("rejects invalid transition %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("defines every database state", () => {
    expect(Object.keys(bookingTransitions).sort()).toEqual(
      Object.values(BookingStatus).sort(),
    );
  });
});
