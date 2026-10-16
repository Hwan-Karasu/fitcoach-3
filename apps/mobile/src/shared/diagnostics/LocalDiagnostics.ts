/** Runtime metadata only. No SQL, parameters, IDs, paths, exceptions or user payloads. */
export type DiagnosticOperation = "db.transaction";
export type DiagnosticOutcome = "committed" | "rolled-back" | "rejected";
export type DiagnosticCode = "DB_WRITE_FAILED" | "WRITES_QUIESCED";

export interface DiagnosticInput {
  readonly operation: DiagnosticOperation;
  readonly outcome: DiagnosticOutcome;
  readonly durationMs: number;
  readonly code?: DiagnosticCode;
}

export interface DiagnosticEvent extends DiagnosticInput {
  readonly sequence: number;
}

export interface DiagnosticSink {
  record(event: DiagnosticInput): void;
}

/** In-memory, bounded, local-only recorder. Explicit fields prevent payload leakage. */
export class LocalDiagnostics implements DiagnosticSink {
  private readonly capacity: number;
  private nextSequence = 1;
  private events: DiagnosticEvent[] = [];

  constructor(capacity = 100) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500) throw new Error("DIAGNOSTIC_CAPACITY_INVALID");
    this.capacity = capacity;
  }

  record(input: DiagnosticInput): void {
    if (input.operation !== "db.transaction" ||
        !["committed", "rolled-back", "rejected"].includes(input.outcome) ||
        (input.code !== undefined && !["DB_WRITE_FAILED", "WRITES_QUIESCED"].includes(input.code))) {
      throw new Error("DIAGNOSTIC_EVENT_INVALID");
    }
    const durationMs = Number.isFinite(input.durationMs)
      ? Math.min(600_000, Math.max(0, Math.round(input.durationMs))) : 0;
    const event: DiagnosticEvent = Object.freeze({
      sequence: this.nextSequence++, operation: input.operation,
      outcome: input.outcome, durationMs,
      ...(input.code === undefined ? {} : { code: input.code }),
    });
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
  }

  snapshot(): readonly DiagnosticEvent[] { return [...this.events]; }

  clear(): void { this.events = []; }
}
