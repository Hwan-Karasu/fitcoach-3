import type { BuilderWeek, MesocycleSettings } from "./PeriodizedModel.ts";

/** An unsaved plan selected from one Excel worksheet. */
export interface BuilderExcelDraft {
  readonly title: string;
  readonly settings?: Partial<MesocycleSettings>;
  readonly weeks: readonly BuilderWeek[];
}
