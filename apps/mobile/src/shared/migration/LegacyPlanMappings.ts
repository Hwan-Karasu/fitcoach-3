import type { LegacyWritePlan } from "./LegacyWritePlan.ts";
export type PlanTargetRow = Readonly<Record<string, string | number | null>>;
export interface PlanDraftMapping {
  readonly sourceTable: string; readonly sourceRowId: string; readonly clientId: string | null;
  readonly targetId: string | null; readonly programId: string | null; readonly weekIndex: number | null; readonly disposition: string;
}

export type LegacyPlanMappingsReader = () => LegacyWritePlan<ReadonlyMap<string, PlanDraftMapping>>;
