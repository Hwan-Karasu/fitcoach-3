import { questionnaireBaseline } from "../QuestionnaireBaseline.generated.ts";
import { legacyProfileQuestionnaireSchema, projectLegacyClientProfile } from "../../domain/legacy-import/LegacyClientProfileProjection.ts";
import { composeLegacyQuestionnaires, type LegacyQuestionnaireSource } from "../../domain/legacy-import/LegacyQuestionnaireComposition.ts";
import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyStageClient, LegacyStageClientIds } from "../../../../shared/migration/LegacyStageExtension.ts";
import { legacyObjectJson } from "../../../../shared/migration/LegacyValues.ts";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";

/** Only an explicit, separately bound R04 rehearsal. These objects never become runtime DDL. */
export const profileRehearsalObjects: Readonly<Record<string, string>> = {
  questionnaire_versions: "table", questionnaire_drafts: "table", questionnaire_answers: "table",
  questionnaire_versions_no_update: "trigger", questionnaire_versions_no_delete: "trigger",
  clients_id_workspace: "index", r04_profile_receipt: "table",
};
/** Client owner creates the prerequisite clients_id_workspace index in the same transaction. */
export function* legacyProfileSchemaPlan(): LegacyWritePlan<void> {
  for (const step of questionnaireBaseline) for (const sql of step.statements) yield run(sql);
  yield run(`CREATE TABLE r04_profile_receipt(id INTEGER PRIMARY KEY CHECK(id=1),
    source_json TEXT NOT NULL CHECK(json_valid(source_json)), target_json TEXT NOT NULL CHECK(json_valid(target_json)))`);
}
export interface LegacyProfileStageResult {
  readonly answerRows: number;
  readonly profileRows: number;
  readonly pendingWorkDataRows: number;
  readonly excludedProductValues: number;
  readonly finalizable: false;
}

function canonical(value: unknown): string {
  function order(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean" || typeof input === "number" && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(order);
    if (input && typeof input === "object" && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null)) {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, order(v)]));
    }
    throw new Error("R04_ID_LEDGER_PROFILE_PAYLOAD_INVALID");
  }
  return JSON.stringify(order(value));
}
/** Writes actual D01 questionnaire rows in the SAME transaction as clients and their ID map.
 * WorkData candidates/exclusions are retained in the private receipt, never claimed as
 * final operational records or as a complete client migration. */
export function* legacyClientProfilesStagePlan(context: CandidateIdentityContext, createdAt: string,
  source: readonly LegacyStageClient[], ids: LegacyStageClientIds,
  questionnaire?: LegacyQuestionnaireSource | null): LegacyWritePlan<LegacyProfileStageResult> {
  const schema = legacyProfileQuestionnaireSchema(); const schemaJson = JSON.stringify(schema);
  const plans = [...source].sort((a, b) => a.identity.sourceIdentityKey < b.identity.sourceIdentityKey ? -1 : 1).map((card) => {
    const rawProfile = legacyObjectJson(card.raw.profile_json);
    if (rawProfile === null) throw new Error("R04_ID_LEDGER_PROFILE_BLOCKED");
    const projection = projectLegacyClientProfile(rawProfile);
    const id = ids.clients.get(card.identity.sourceIdentityKey);
    if (!id || projection.answers === null || projection.issues.length > 0) throw new Error("R04_ID_LEDGER_PROFILE_BLOCKED");
    return { card, id, projection };
  });
  const composition = questionnaire == null ? null : composeLegacyQuestionnaires(context, createdAt,
    plans.map(({ card, id, projection }) => ({ sourceClientId: card.identity.sourceClientId, targetClientId: id,
      answers: projection.answers!, updatedAt: card.identity.updatedAt! })), questionnaire);
  const answers = composition?.answers ?? plans.flatMap(({ card, id, projection }) => Object.entries(projection.answers!).sort(([a], [b]) => a < b ? -1 : 1).map(([field, value]) => ({
    workspace_id: context.targetWorkspaceId, client_id: id, field_id: field, value_json: JSON.stringify(value),
    schema_version: 1, updated_at: card.identity.updatedAt,
  }))).sort((a, b) => a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : a.field_id < b.field_id ? -1 : 1);
  const versions = composition?.versions ?? [{ workspace_id: context.targetWorkspaceId, version: 1, format_version: 1, schema_json: schemaJson, base_version: null, published_at: createdAt }];
  const drafts = composition?.drafts ?? [{ workspace_id: context.targetWorkspaceId, base_version: 1, revision: 1, schema_json: schemaJson, updated_at: createdAt }];
  const rawCards = plans.map(({ card }) => ({ sourceKey: card.identity.sourceIdentityKey, raw: card.raw }));
  const sourceJson = canonical(questionnaire === undefined ? rawCards : { cards: rawCards, questionnaire: composition?.sourceRaw ?? null });
  const targetJson = canonical({ versions, drafts, answers, workData: plans.map(({ card, id, projection }) => ({
    sourceKey: card.identity.sourceIdentityKey, clientId: id, candidates: projection.workData, excludedByProduct: projection.excludedByProduct,
  })), ...(questionnaire === undefined ? {} : { questionnaire: composition?.provenance ?? null }) });
  const receipts = yield query("SELECT * FROM r04_profile_receipt");
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) {
    throw new Error("R04_ID_LEDGER_PROFILE_PARITY_MISMATCH");
  }
  const existing = receipts.length === 1;
  if (!existing) {
    for (const table of ["questionnaire_versions", "questionnaire_drafts", "questionnaire_answers"]) {
      if ((yield query(`SELECT count(*) AS n FROM ${table}`))[0]?.n !== 0) throw new Error("R04_ID_LEDGER_PROFILE_FOREIGN_TARGET");
    }
    for (const row of versions) yield run("INSERT INTO questionnaire_versions(workspace_id,version,format_version,schema_json,base_version,published_at) VALUES(?,?,?,?,?,?)", [row.workspace_id, row.version, row.format_version, row.schema_json, row.base_version, row.published_at]);
    for (const row of drafts) yield run("INSERT INTO questionnaire_drafts(workspace_id,base_version,revision,schema_json,updated_at) VALUES(?,?,?,?,?)", [row.workspace_id, row.base_version, row.revision, row.schema_json, row.updated_at]);
  }
  for (const { id } of plans) {
    if (!existing) for (const row of answers.filter((answer) => answer.client_id === id)) {
      yield run("INSERT INTO questionnaire_answers(workspace_id,client_id,field_id,value_json,schema_version,updated_at) VALUES(?,?,?,?,?,?)", [row.workspace_id, row.client_id, row.field_id, row.value_json, row.schema_version, row.updated_at]);
    }
    yield { kind: "checkpoint", phase: "after-profile" } as const;
  }
  if (!existing) yield run("INSERT INTO r04_profile_receipt VALUES(1,?,?)", [sourceJson, targetJson]);
  for (const [table, expected, sort] of [
    ["questionnaire_versions", versions, "workspace_id,version"], ["questionnaire_drafts", drafts, "workspace_id"],
    ["questionnaire_answers", answers, "client_id,field_id"],
  ] as const) {
    if (canonical((yield query(`SELECT * FROM ${table} ORDER BY ${sort}`)).map((row) => ({ ...row }))) !== canonical(expected)) {
      throw new Error("R04_ID_LEDGER_PROFILE_PARITY_MISMATCH");
    }
  }
  const receipt = (yield query("SELECT * FROM r04_profile_receipt WHERE id=1"))[0];
  if (receipt?.source_json !== sourceJson || receipt?.target_json !== targetJson) throw new Error("R04_ID_LEDGER_PROFILE_PARITY_MISMATCH");
  return { answerRows: answers.length, profileRows: plans.length,
    pendingWorkDataRows: plans.filter(({ projection: { workData: w } }) => w.trainerNote !== null || w.manualTags.length > 0 || w.loadAvoidance !== null || w.safety.length > 0).length,
    excludedProductValues: plans.reduce((n, { projection }) => n + projection.excludedByProduct.length, 0),
    finalizable: false as const };
}
