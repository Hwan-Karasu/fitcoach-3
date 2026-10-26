/** PRIVATE SYNTHETIC D01/R04 proof only. Not registered in production catalogs,
 * not an upgrade of a real database and not permission to bypass schema gates. */
import { createHash } from "node:crypto";
import type { DatabaseOwnerCatalog } from "../../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { immutableScope } from "../../apps/mobile/src/shared/db/SchemaGuards.ts";
import { WORK_DATA_FORMAT } from "../../apps/mobile/src/features/clients/data/ClientWorkDataRows.ts";
const revision = "revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991)";
const clientFk = "FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT";
const statements = [
  `CREATE TABLE client_work_data_format(id INTEGER PRIMARY KEY CHECK(id=1),format_version INTEGER NOT NULL CHECK(format_version=1),tag_name_policy TEXT NOT NULL)`,
  `INSERT INTO client_work_data_format VALUES(1,${WORK_DATA_FORMAT.version},'${WORK_DATA_FORMAT.tagNamePolicy}')`,
  `CREATE TABLE trainer_notes(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,
    body TEXT NOT NULL CHECK(length(trim(body))>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,pinned INTEGER NOT NULL CHECK(pinned IN(0,1)),
    context_json TEXT NOT NULL CHECK(json_valid(context_json) AND (json_type(context_json)='null' OR COALESCE((json_type(context_json)='object'
      AND json_extract(context_json,'$.type')='LEGACY_IMPORT' AND json_type(context_json,'$.reference')='text'
      AND length(trim(json_extract(context_json,'$.reference')))>0),0))),${revision},${clientFk})`,
  `CREATE INDEX trainer_notes_timeline ON trainer_notes(workspace_id,client_id,pinned DESC,created_at DESC,id)`,
  `CREATE TABLE trainer_tags(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK(length(trim(name))>0),normalized_name TEXT NOT NULL CHECK(length(trim(normalized_name))>0),color TEXT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN('ACTIVE','ARCHIVED')),${revision},UNIQUE(id,workspace_id),UNIQUE(workspace_id,normalized_name))`,
  `CREATE TABLE client_tag_assignments(workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,tag_id TEXT NOT NULL,PRIMARY KEY(workspace_id,client_id,tag_id),
    ${clientFk},FOREIGN KEY(tag_id,workspace_id) REFERENCES trainer_tags(id,workspace_id) ON DELETE RESTRICT)`,
  `CREATE INDEX client_tag_assignments_tag ON client_tag_assignments(workspace_id,tag_id,client_id)`,
  `CREATE TABLE client_safety_import_reviews(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status='PENDING_REVIEW'),source_field TEXT NOT NULL CHECK(source_field IN('diagnoses','injuries','pain','hardMovements','unwantedLoad')),
    body TEXT NOT NULL CHECK(length(trim(body))>0),imported_at TEXT NOT NULL,source_client_updated_at TEXT NOT NULL,${clientFk})`,
  `CREATE INDEX client_safety_import_reviews_client ON client_safety_import_reviews(workspace_id,client_id,imported_at,id)`,
  `CREATE TABLE client_work_import_evidence(workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,
    source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),source_key TEXT NOT NULL CHECK(length(trim(source_key))>0),
    imported_at TEXT NOT NULL,source_json TEXT NOT NULL CHECK(json_valid(source_json) AND json_type(source_json)='object'),
    projection_json TEXT NOT NULL CHECK(json_valid(projection_json) AND json_type(projection_json)='object'),
    PRIMARY KEY(workspace_id,client_id,source_sha256,source_key),${clientFk})`,
  immutableScope("trainer_notes", ["id", "workspace_id", "client_id", "created_at", "context_json"]),
  immutableScope("trainer_tags", ["id", "workspace_id"]),
  immutableScope("client_tag_assignments", ["workspace_id", "client_id", "tag_id"]),
  immutableScope("client_safety_import_reviews", ["id", "workspace_id", "client_id", "source_field", "body", "imported_at", "source_client_updated_at"]),
  `CREATE TRIGGER client_work_import_evidence_fixed BEFORE UPDATE ON client_work_import_evidence BEGIN SELECT RAISE(ABORT,'WORK_DATA_EVIDENCE_IMMUTABLE'); END`,
];
export const clientWorkDataCandidateOwner: DatabaseOwnerCatalog = { owner: "client-work-data-candidate", ledger: "client_work_data_schema_migrations",
  chain: [{ version: 1, checksum: createHash("sha256").update(statements.join("\n")).digest("hex"), statements }] };
