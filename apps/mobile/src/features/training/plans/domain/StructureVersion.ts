import type { Mesocycle } from "./PeriodizedModel.ts";

/** A structural snapshot only. Execution facts are always read from their owner. */
export interface MesocycleVersion {
  readonly id: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly structure: Mesocycle;
}
