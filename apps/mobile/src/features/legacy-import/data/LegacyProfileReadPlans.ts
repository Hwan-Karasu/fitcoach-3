import type { LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../domain/LegacySourceSnapshots.ts";
import { legacySourceTablePresent, readLegacySourceTable as read, type LegacySourceReadPlan } from "./LegacySourceReadPlans.ts";

const identityColumns = ["id", "workspace_id", "name", "created_at", "updated_at", "archived_at", "deleted_at"];
const cardColumns = ["id", "workspace_id", "birthdate", "height", "gender", "avatar_emoji", "profile_json"];
function scope(value: string) { if (!value.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED"); }

/** Full raw rows for all clients, including archived/deleted owners and unknown fields. */
export function* legacyClientsReadPlan(accountScope: string, shape: "identity" | "card" | "full" = "full"): LegacySourceReadPlan<LegacyClientsSource> {
  scope(accountScope);
  const error = shape === "identity" ? "R04_CLIENT_IDENTITY_SHAPE_UNSUPPORTED" : "R04_CLIENT_CARD_SHAPE_UNSUPPORTED";
  const rows = yield* read("clients", shape === "identity" ? identityColumns : shape === "card" ? cardColumns : [...identityColumns, ...cardColumns], error, "R04_CLIENT_IDENTITY_CARDINALITY_MISMATCH", undefined, ["id"]);
  if (rows === null) throw new Error(error);
  return { accountScope, rows };
}

export function* legacyExerciseCatalogReadPlan(accountScope: string): LegacySourceReadPlan<LegacyExerciseCatalogSource> {
  scope(accountScope);
  const error = "R04_EXERCISE_SHAPE_UNSUPPORTED";
  const rows = yield* read("exercise_catalog", ["id", "name", "category", "equipment", "aliases_json", "source", "created_at", "updated_at", "deleted_at"], error, "R04_EXERCISE_CATALOG_COVERAGE_MISMATCH", undefined, ["id"]);
  if (rows === null) throw new Error(error);
  return { accountScope, rows };
}

/** No active revision selection or JSON conversion here. Partial stores cannot mean no questionnaire. */
export function* legacyQuestionnaireReadPlan(accountScope: string): LegacySourceReadPlan<LegacyQuestionnaireSource | null> {
  scope(accountScope);
  const shape = "R04_QUESTIONNAIRE_SHAPE_UNSUPPORTED", coverage = "R04_QUESTIONNAIRE_COVERAGE_MISMATCH";
  const present: boolean[] = [];
  for (const table of ["questionnaire_templates", "questionnaire_revisions", "client_questionnaire_answers", "questionnaire_change_sets"]) present.push(yield* legacySourceTablePresent(table, shape));
  if (present.every((value) => !value)) return null;
  if (present.slice(0, 3).some((value) => !value)) throw new Error("R04_QUESTIONNAIRE_TABLES_INCOMPLETE");
  const templates = yield* read("questionnaire_templates", ["workspace_id", "draft_revision_id", "published_revision_id", "updated_at"], shape, coverage, undefined, ["workspace_id"]);
  const revisions = yield* read("questionnaire_revisions", ["id", "workspace_id", "revision", "status", "schema_json", "created_at", "published_at"], shape, coverage, undefined, ["workspace_id", "revision", "id"]);
  const answers = yield* read("client_questionnaire_answers", ["client_id", "question_id", "value_json", "template_revision", "updated_at", "deleted_at"], shape, coverage, undefined, ["client_id", "question_id"]);
  const changes = yield* read("questionnaire_change_sets", ["id"], shape, coverage, undefined, ["id"]);
  if (templates === null && revisions === null && answers === null && changes === null) return null;
  if (templates === null || revisions === null || answers === null) throw new Error("R04_QUESTIONNAIRE_TABLES_INCOMPLETE");
  const owners = yield* read("clients", ["id", "workspace_id"], shape, coverage);
  if (owners === null) throw new Error(shape);
  return { accountScope, owners, templates, revisions, answers, changes };
}
