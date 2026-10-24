import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { legacyClientWorkDataStagingExtension } from "../../apps/mobile/src/features/clients/data/legacy-import/LegacyClientWorkDataStaging.ts";
import { legacyQuestionnaireStagingExtension } from "../../apps/mobile/src/features/questionnaire/data/legacy-import/LegacyQuestionnaireStaging.ts";
import { legacyExerciseCatalogStagingExtension } from "../../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseCatalogStaging.ts";
import { legacyPlansStagingExtension } from "../../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStaging.ts";
import { legacyLoadPlanMappingsPlan, plansRehearsalObjects } from "../../apps/mobile/src/features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import { legacyExecutionStagingExtension } from "../../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStaging.ts";
import { combineLegacyStageExtensions } from "../../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import type { LegacyImportSourceSnapshots } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { readAdmittedLegacyDomainSnapshots } from "../../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./legacy-backup-metadata.ts";
import { seed, cache, addWorkoutLog, oldWorkoutLog, date0 } from "./legacy-execution-source.ts";
import { nativeFactory } from "./legacy-staging-native.ts";

import { executionRehearsalObjects } from "../../apps/mobile/src/features/training/execution/data/legacy-import/LegacyExecutionStagePlan.ts";
export const scope = "portable-execution-writer", importedAt = "2026-10-24T12:00:00Z";
export const allocator = () => { let next = 0; return () => `11111111-1111-4111-8111-${String(++next).padStart(12, "0")}`; };
export const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const earlier = ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients", "questionnaire_versions", "questionnaire_drafts", "questionnaire_answers", "r04_profile_receipt",
  "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt", "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt"];
export const tables = [...earlier, ...Object.entries({ ...plansRehearsalObjects, ...executionRehearsalObjects }).filter(([, kind]) => kind === "table").map(([name]) => name)];
export function owners(s: LegacyImportSourceSnapshots) { return combineLegacyStageExtensions(legacyQuestionnaireStagingExtension(s.questionnaire), legacyClientWorkDataStagingExtension(),
  legacyExerciseCatalogStagingExtension(s.exerciseCatalog, { accountScope: scope, clients: s.clients.rows, workouts: s.plans.tables.training_workouts, exercises: s.plans.tables.training_exercises, history: s.executions.tables.training_exercise_history }), legacyPlansStagingExtension(s.plans)); }
export const extension = (s: LegacyImportSourceSnapshots) => combineLegacyStageExtensions(owners(s), legacyExecutionStagingExtension(s.plans, s.executions, () => legacyLoadPlanMappingsPlan(true)));
export function inspect<Result>(path: string, run: (db: DatabaseSync) => Result): Result { const db = new DatabaseSync(path); try { return run(db); } finally { db.close(); } }
export const records = (path: string) => inspect(path, (db) => tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
export function empty(path: string) { inspect(path, (db) => {
  for (const table of tables.filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }
function seedSource(db: DatabaseSync) {
  seed(db); seedLegacyBackupMetadata(db, scope, { existingDomainTables: true });
  db.exec(`CREATE TABLE training_library_programs(id TEXT PRIMARY KEY,client_id TEXT,name TEXT,mode TEXT,created_at TEXT,archived_at TEXT);
    CREATE TABLE training_workspaces(client_id TEXT,active_program_id TEXT,week_state_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_program_view_state(actor_id TEXT,client_id TEXT,library_id TEXT,selected_program_id TEXT,state_json TEXT);
    CREATE TABLE training_library_preferences(actor_id TEXT,client_id TEXT,preferred_id TEXT);`);
  addWorkoutLog(db, oldWorkoutLog()); cache(db, "log-cache", "old-log:e-a0:0", date0, "completed-at", "w-a0", "20", "10", "old-log");
  db.exec("UPDATE training_set_logs SET data_json=json_set(data_json,'$.historyDateStatus','imported-unknown') WHERE exercise_id='e-a0'");
  db.exec(`CREATE TABLE questionnaire_templates(workspace_id TEXT PRIMARY KEY,draft_revision_id TEXT,published_revision_id TEXT,updated_at TEXT);
    CREATE TABLE questionnaire_revisions(id TEXT PRIMARY KEY,workspace_id TEXT,revision INTEGER,status TEXT,schema_json TEXT,created_at TEXT,published_at TEXT);
    CREATE TABLE client_questionnaire_answers(client_id TEXT,question_id TEXT,value_json TEXT,template_revision INTEGER,updated_at TEXT,deleted_at TEXT,PRIMARY KEY(client_id,question_id));`);
  const schema = JSON.stringify({ version: 1, sections: [{ id: "custom", title: "Original section", icon: "", hidden: false,
    questions: [{ id: "custom-question", title: "Original question", type: "short_text", required: false, access: "trainer_only", options: [], hidden: false }] }] });
  for (const [id, version, status] of [["published", 1, "published"], ["draft", 2, "draft"]] as const) db.prepare("INSERT INTO questionnaire_revisions VALUES(?,?,?,?,?,?,?)").run(id, "source-workspace", version, status, schema, date0, status === "published" ? date0 : null);
  db.prepare("INSERT INTO questionnaire_templates VALUES(?,?,?,?)").run("source-workspace", "draft", "published", date0);
  db.prepare("INSERT INTO client_questionnaire_answers VALUES(?,?,?,?,?,?)").run("a", "custom-question", '"Original answer"', 1, date0, null);
}
async function setup(dir: string, amend: (db: DatabaseSync) => void) {
  const sourcePath = join(dir, "source.sqlite"), db = new DatabaseSync(sourcePath); seedSource(db); amend(db); updateLegacyManifestSize(db); db.close();
  const sha = digest(sourcePath), input = nativeFactory(sourcePath);
  const { admission, snapshots } = await readAdmittedLegacyDomainSnapshots(input.open, statSync(sourcePath).size);
  assert.equal(input.handles.size, 0); assert.equal(digest(sourcePath), sha);
  const stagePath = join(dir, "stage.sqlite");
  return { dir, sourcePath, sha, snapshots, stagePath, native: nativeFactory(stagePath), context: { sourceSha256: sha, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" } };
}
export async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>, amend: (db: DatabaseSync) => void = () => undefined) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-execution-stage-"));
  try { await run(await setup(dir, amend)); }
  finally { const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("athlete-r04-execution-stage-")); rmSync(absolute, { recursive: true, force: true }); }
}
