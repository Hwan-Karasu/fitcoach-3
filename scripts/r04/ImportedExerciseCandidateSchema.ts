/** PRIVATE synthetic schema candidate. Not a production migration/owner registry. */
import { createHash } from "node:crypto";
import type { DatabaseOwnerCatalog } from "../../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { immutableScope } from "../../apps/mobile/src/shared/db/SchemaGuards.ts";
import { IMPORTED_EXERCISE_FORMAT } from "../../apps/mobile/src/features/exercises/data/ImportedExerciseStore.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS } from "../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
const values = (items: readonly string[]) => items.map((v) => `'${v}'`).join(",");
const statements = [
  "CREATE TABLE exercise_import_format(id INTEGER PRIMARY KEY CHECK(id=1),format_version INTEGER NOT NULL CHECK(format_version=1),policy TEXT NOT NULL)",
  `INSERT INTO exercise_import_format VALUES(1,1,'${IMPORTED_EXERCISE_FORMAT}')`,
  `CREATE TABLE imported_exercises(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    origin TEXT NOT NULL CHECK(origin IN('CUSTOM','SYSTEM')),name TEXT NOT NULL CHECK(length(trim(name))>0),body_part TEXT CHECK(body_part IS NULL OR body_part IN(${values(BODY_PARTS)})),
    equipment TEXT CHECK(equipment IS NULL OR length(trim(equipment))>0),equipment_unspecified INTEGER NOT NULL CHECK(equipment_unspecified IN(0,1) AND (equipment_unspecified=0 OR equipment IS NULL)),
    tracking_profile TEXT NOT NULL CHECK(tracking_profile IN(${values(TRACKING_PROFILE_IDS)})),revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,source_catalog_id TEXT NOT NULL,source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
    source_json TEXT NOT NULL CHECK(json_valid(source_json) AND json_type(source_json)='object'),UNIQUE(id,workspace_id),UNIQUE(workspace_id,source_catalog_id),
    CHECK((origin='CUSTOM' AND substr(id,1,4)='usr:') OR (origin='SYSTEM' AND substr(id,1,14)='sys:legacy-v2:')))`,
  "CREATE INDEX imported_exercises_active ON imported_exercises(workspace_id,archived_at,id)",
  `CREATE TABLE imported_exercise_links(source_key TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,source_table TEXT NOT NULL CHECK(source_table IN('training_exercises','training_exercise_history')),
    source_row_id TEXT NOT NULL,source_client_id TEXT NOT NULL,target_client_id TEXT NOT NULL,target_exercise_id TEXT NOT NULL,source_deleted_at TEXT,
    source_json TEXT NOT NULL CHECK(json_valid(source_json)),FOREIGN KEY(target_client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY(target_exercise_id,workspace_id) REFERENCES imported_exercises(id,workspace_id) ON DELETE RESTRICT)`,
  "CREATE INDEX imported_exercise_links_client ON imported_exercise_links(workspace_id,target_client_id,source_key)",
  `CREATE TABLE imported_exercise_fact_use(workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,exercise_id TEXT NOT NULL,fact_id TEXT PRIMARY KEY NOT NULL,
    FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY(exercise_id,workspace_id) REFERENCES imported_exercises(id,workspace_id) ON DELETE RESTRICT)`,
  "CREATE INDEX imported_exercise_fact_use_exercise ON imported_exercise_fact_use(workspace_id,exercise_id,fact_id)",
  immutableScope("imported_exercises", ["id", "workspace_id", "origin", "created_at", "source_catalog_id", "source_sha256", "source_json"]),
  "CREATE TRIGGER imported_exercises_profile_used BEFORE UPDATE OF tracking_profile ON imported_exercises WHEN NEW.tracking_profile<>OLD.tracking_profile AND EXISTS(SELECT 1 FROM imported_exercise_fact_use WHERE workspace_id=OLD.workspace_id AND exercise_id=OLD.id) BEGIN SELECT RAISE(ABORT,'EXERCISE_PROFILE_IN_USE'); END",
  "CREATE TRIGGER imported_exercises_system_fixed BEFORE UPDATE ON imported_exercises WHEN OLD.origin='SYSTEM' BEGIN SELECT RAISE(ABORT,'EXERCISE_SYSTEM_READ_ONLY'); END",
  "CREATE TRIGGER imported_exercises_delete_blocked BEFORE DELETE ON imported_exercises BEGIN SELECT RAISE(ABORT,'EXERCISE_ARCHIVE_REQUIRED'); END",
];
export const importedExerciseCandidateOwner: DatabaseOwnerCatalog = { owner: "imported-exercises-candidate", ledger: "exercise_import_schema_migrations",
  chain: [{ version: 1, checksum: createHash("sha256").update(statements.join("\n")).digest("hex"), statements }] };
