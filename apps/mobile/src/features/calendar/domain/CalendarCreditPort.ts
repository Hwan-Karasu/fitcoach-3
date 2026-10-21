/** Credit information Calendar may show; owned and computed by SessionAccounting (§22.1.4). */
export type CalendarBookingCredit =
  | Readonly<{ kind: "NOT_TRACKED" }>
  | Readonly<{ kind: "NOT_REQUIRED" }>
  | Readonly<{ kind: "AVAILABLE"; available: number; preferredPackTitle?: string }>
  | Readonly<{ kind: "PREFERRED_UNAVAILABLE" }>
  | Readonly<{ kind: "NONE_AVAILABLE" }>;

export type CalendarAppointmentCredit = "NONE" | "RESERVED" | "USED" | "RETURNED";

export interface CalendarCreditPort {
  bookingContext(clientId: string, sessionTypeId: string, requiresCredit: boolean): Promise<CalendarBookingCredit>;
  appointmentCredit(appointmentId: string): Promise<CalendarAppointmentCredit>;
}
