import type { LegacyStageExtension } from "../../../../../shared/migration/LegacyStageExtension.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "../../../../../shared/migration/LegacyPlanSources.ts";
import { captureLegacySourceRow } from "../../../../../shared/migration/LegacySourceCapture.ts";
import { legacyPlansSchemaPlan, legacyPlansStagePlan, plansRehearsalObjects, type LegacyPlansStageResult } from "./LegacyPlansStagePlan.ts";
import type { LegacyBuilderDraftInput } from "../../domain/legacy-import/LegacyBuilderDrafts.ts";

/** Select the complete immutable mode before opening a fresh candidate staging file. */
export function legacyPlansStagingExtension(source: LegacyPlansSource, options: { readonly templates: boolean; readonly archives: boolean } = { templates: true, archives: true }, drafts?: LegacyBuilderDraftInput): LegacyStageExtension<LegacyPlansStageResult> {
  const { templates, archives } = options;
  if (archives && !templates) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (Object.keys(source.tables).length !== PLAN_SOURCE_TABLES.length || PLAN_SOURCE_TABLES.some((table) => source.tables[table] !== null && !Array.isArray(source.tables[table]))) throw new Error("R04_ID_LEDGER_PLANS_SOURCE_TABLE_MISSING");
  const snapshot: LegacyPlansSource = { accountScope: source.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((table) => [table, source.tables[table]?.map(captureLegacySourceRow) ?? null])) as LegacyPlansSource["tables"] };
  const draftSnapshot = drafts === undefined ? undefined : { settings: { accountScope: drafts.settings.accountScope, rows: drafts.settings.rows?.map(captureLegacySourceRow) ?? null },
    facts: { accountScope: drafts.facts.accountScope, segments: drafts.facts.segments?.map(captureLegacySourceRow) ?? null } };
  return Object.freeze<LegacyStageExtension<LegacyPlansStageResult>>({
    modeTags: Object.freeze(["TRAINING_PLANS_REHEARSAL_V1", "TRAINING_VIEW_SELECTIONS_REHEARSAL_V1", "TRAINING_SCOPE_LINEAGES_REHEARSAL_V1", "TRAINING_REST_SETTINGS_REHEARSAL_V1", ...(templates ? ["TRAINING_TEMPLATES_REHEARSAL_V1"] : []), ...(archives ? ["TRAINING_ARCHIVES_REHEARSAL_V1"] : []), ...(drafts ? ["TRAINING_BUILDER_DRAFTS_REHEARSAL_V1"] : [])]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1", "WORK_DATA_REHEARSAL_V1", "EXERCISE_REGISTRY_REHEARSAL_V1"]),
    objects: Object.freeze({ ...plansRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyPlansSchemaPlan,
    stage: (context, importedAt, clients, ids, allocate) => legacyPlansStagePlan(context, importedAt, clients, ids, snapshot, allocate, templates, archives, draftSnapshot),
  });
}
