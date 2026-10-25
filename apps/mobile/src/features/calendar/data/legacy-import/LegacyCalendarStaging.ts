import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import type { LegacyCalendarSnapshot } from "../../../../shared/migration/LegacyCalendarSources.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { legacyCalendarSchemaPlan, legacyCalendarStagePlan, calendarRehearsalObjectsFor, type LegacyCalendarStageResult } from "./LegacyCalendarStagePlan.ts";

/** Composition supplies accounting's existing schema; the owner is never imported here. */
export function legacyCalendarStagingExtension(source: LegacyCalendarSnapshot, accountingStatements: readonly string[]): LegacyStageExtension<LegacyCalendarStageResult> {
  if (Object.keys(source).length !== 4 || source.appointments !== null && !Array.isArray(source.appointments)
    || source.plannerRows !== null && !Array.isArray(source.plannerRows) || !Array.isArray(source.unsupportedAccountingTables)
    || source.unsupportedAccountingTables.some((name) => typeof name !== "string")) throw new Error("R04_ID_LEDGER_CALENDAR_SOURCE_INVALID");
  if (!Array.isArray(accountingStatements) || !accountingStatements.length || accountingStatements.some((sql) => typeof sql !== "string" || !sql.trim())) throw new Error("R04_ID_LEDGER_CALENDAR_SCHEMA_UNAVAILABLE");
  const schema = Object.freeze([...accountingStatements]);
  const snapshot: LegacyCalendarSnapshot = { accountScope: source.accountScope, appointments: source.appointments?.map(captureLegacySourceRow) ?? null,
    plannerRows: source.plannerRows?.map(captureLegacySourceRow) ?? null, unsupportedAccountingTables: [...source.unsupportedAccountingTables] };
  return Object.freeze<LegacyStageExtension<LegacyCalendarStageResult>>({
    modeTags: Object.freeze(["CALENDAR_REHEARSAL_V1"]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1", "EXERCISE_REGISTRY_REHEARSAL_V1", "TRAINING_PLANS_REHEARSAL_V1", "TRAINING_TEMPLATES_REHEARSAL_V1", "TRAINING_ARCHIVES_REHEARSAL_V1", "TRAINING_EXECUTIONS_REHEARSAL_V3", "MEASUREMENTS_REHEARSAL_V2", "NUTRITION_REHEARSAL_V3"]),
    objects: Object.freeze(calendarRehearsalObjectsFor(schema)), clientWorkspaceIndex: true,
    createSchema: () => legacyCalendarSchemaPlan(schema),
    stage: (context, importedAt, clients, ids, allocate) => legacyCalendarStagePlan(context, importedAt, clients, ids, snapshot, allocate, schema),
  });
}
