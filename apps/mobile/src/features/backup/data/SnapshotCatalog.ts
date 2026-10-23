import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";

export const MEDIA_CHUNK_BYTES = 256 * 1024;
export const MEDIA_TABLE = "at_backup_media";
export const MEDIA_CHUNKS = "at_backup_media_chunks";
export const MANIFEST_TABLE = "at_backup_manifest";
export const SNAPSHOT_LEDGER = "at_backup_schema_migrations";
// Frozen snapshot-only migrations. Never applied to a working database.
const manifestDdl = `CREATE TABLE ${MANIFEST_TABLE} (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  json TEXT NOT NULL CHECK (json_valid(json) AND json_type(json) = 'object'))`;
export const mediaDdl = [
  `CREATE TABLE ${MEDIA_TABLE} (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'),
    source_uri TEXT UNIQUE NOT NULL CHECK (length(source_uri) BETWEEN 1 AND 2000),
    mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','image/heic')),
    byte_length INTEGER NOT NULL CHECK (typeof(byte_length) = 'integer' AND byte_length > 0 AND byte_length <= 9007199254740991),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    chunk_count INTEGER NOT NULL CHECK (typeof(chunk_count) = 'integer' AND chunk_count > 0 AND chunk_count <= 9007199254740991))`,
  `CREATE TABLE ${MEDIA_CHUNKS} (
    media_id TEXT NOT NULL, position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
    data BLOB NOT NULL CHECK (typeof(data) = 'blob' AND length(data) BETWEEN 1 AND ${MEDIA_CHUNK_BYTES}),
    PRIMARY KEY (media_id, position),
    FOREIGN KEY (media_id) REFERENCES ${MEDIA_TABLE}(id) ON DELETE RESTRICT)`,
] as const;
const checksum = (sql: string) => bytesToHex(sha256(utf8ToBytes(sql)));
export const SNAPSHOT_OWNER: DatabaseOwnerCatalog = { owner: "backup-snapshot", ledger: SNAPSHOT_LEDGER,
  chain: [{ version: 1, checksum: checksum(manifestDdl), statements: [manifestDdl] },
    { version: 2, checksum: checksum(mediaDdl.join("\n")), statements: mediaDdl }] };
export const SNAPSHOT_OBJECTS: ReadonlySet<string> = new Set([MANIFEST_TABLE, SNAPSHOT_LEDGER, MEDIA_TABLE, MEDIA_CHUNKS]);
