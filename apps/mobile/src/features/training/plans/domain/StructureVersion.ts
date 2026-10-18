import type { Mesocycle } from "./PeriodizedModel.ts";

/** Только снимок структуры; факты выполнения всегда читаются у их владельца — дневника. */
export interface MesocycleVersion {
  readonly id: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly structure: Mesocycle;
}
