import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, openSync, readSync, realpathSync, statSync,
  unlinkSync, writeSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { SnapshotError, type SnapshotMediaSummary } from "./SnapshotContract.ts";

export const MEDIA_CHUNK_BYTES = 256 * 1024;
export const MEDIA_TABLE = "at_backup_media";
export const MEDIA_CHUNKS = "at_backup_media_chunks";
const mimes = ["image/png", "image/jpeg", "image/webp", "image/heic"] as const;
type ImageMime = typeof mimes[number];
const extension: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic" };
const shaPattern = /^[a-f0-9]{64}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const shaText = (value: string) => createHash("sha256").update(value).digest("hex");
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
interface MediaRow {
  readonly id: string;
  readonly source_uri: string;
  readonly mime: ImageMime;
  readonly byte_length: number;
  readonly sha256: string;
  readonly chunk_count: number;
}
export interface RecipePhotoReference { readonly id: string; readonly originalJson: string; readonly sourceUri: string }
export interface RestoredRecipePhoto extends RecipePhotoReference { readonly restoredUri: string }
export interface SnapshotMediaProgress {
  readonly phase: "EMBEDDED" | "WRITING" | "PUBLISHED";
  readonly completedBytes: number;
  readonly totalBytes: number;
}
export interface SnapshotMediaOptions {
  readonly mediaRoot?: string;
  readonly restoreId?: string;
  /** Content-free progress, also used for process-death rehearsal boundaries. */
  readonly onMediaProgress?: (progress: SnapshotMediaProgress) => void;
}
function progress(options: SnapshotMediaOptions, phase: SnapshotMediaProgress["phase"], completedBytes: number, totalBytes: number): void {
  try { options.onMediaProgress?.({ phase, completedBytes, totalBytes }); }
  catch { /* A progress observer cannot change the persisted operation's outcome. */ }
}

function incomplete(): never { throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA"); }
function invalid(): never { throw new SnapshotError("SNAPSHOT_INVALID"); }
function fileUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  try { const url = new URL(uri); return url.protocol === "file:" && url.host === "" && url.search === "" && url.hash === ""; }
  catch { return false; }
}
export function recipePhotoReferences(db: DatabaseSync): readonly RecipePhotoReference[] {
  const result: RecipePhotoReference[] = [];
  for (const row of db.prepare("SELECT id, details_json FROM recipes WHERE details_json IS NOT NULL ORDER BY id").iterate()) {
    if (typeof row.id !== "string" || typeof row.details_json !== "string") invalid();
    const value: unknown = JSON.parse(row.details_json);
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const uri = (value as Record<string, unknown>).photoUri;
    if (uri === null || uri === undefined) continue;
    if (!fileUri(uri)) incomplete();
    result.push({ id: row.id, originalJson: row.details_json, sourceUri: uri });
  }
  return result;
}
function rootPath(root: string | undefined): string {
  if (!root) incomplete();
  const canonical = realpathSync(root);
  if (!statSync(canonical).isDirectory()) incomplete();
  return canonical;
}
function confined(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}
/** Verify a local signature, never trust the old filename extension as a MIME type.
 * Full Android decoder acceptance is still a native gate, not proven by these magic bytes. */
function imageMime(bytes: Uint8Array): ImageMime {
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(buffer.toString("ascii", 8, 12))) return "image/heic";
  return incomplete();
}
function checkedBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function addSafe(total: number, more: number): number {
  const sum = total + more;
  if (!Number.isSafeInteger(sum)) invalid();
  return sum;
}
function descriptorDigest(rows: Iterable<MediaRow>): SnapshotMediaSummary {
  const hash = createHash("sha256").update("athlete-snapshot-media-v1\n");
  let bytes = 0; let entries = 0;
  for (const row of rows) {
    hash.update(JSON.stringify([row.id, row.source_uri, row.mime, row.byte_length, row.sha256, row.chunk_count])); hash.update("\n");
    bytes = addSafe(bytes, row.byte_length); entries++;
  }
  return { version: 1, entries, bytes, sha256: hash.digest("hex") };
}
function descriptors(db: DatabaseSync): IterableIterator<MediaRow> {
  return db.prepare(`SELECT id, source_uri, mime, byte_length, sha256, chunk_count FROM ${MEDIA_TABLE} ORDER BY id`).iterate() as IterableIterator<MediaRow>;
}

/** Called inside the snapshot's metadata transaction. The application image store writes new
 * immutable filenames. If a source disappears/changes, fail this copy instead of omitting it. */
export function embedRecipePhotos(db: DatabaseSync, options: SnapshotMediaOptions = {}): SnapshotMediaSummary {
  const references = recipePhotoReferences(db);
  if (references.length === 0) return descriptorDigest([]);
  const root = rootPath(options.mediaRoot);
  const uris = [...new Set(references.map((row) => row.sourceUri))].sort();
  const insertAsset = db.prepare(`INSERT INTO ${MEDIA_TABLE} (id, source_uri, mime, byte_length, sha256, chunk_count) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertChunk = db.prepare(`INSERT INTO ${MEDIA_CHUNKS} (media_id, position, data) VALUES (?, ?, ?)`);
  for (const uri of uris) {
    let file: string;
    try { file = realpathSync(fileURLToPath(uri)); } catch { return incomplete(); }
    if (!confined(root, file)) incomplete();
    const fd = openSync(file, "r");
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size <= 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) incomplete();
      const size = Number(before.size); const id = shaText(uri);
      const buffer = Buffer.alloc(Math.min(MEDIA_CHUNK_BYTES, size));
      const hash = createHash("sha256");
      let offset = 0; let position = 0; let mime: ImageMime | null = null;
      while (offset < size) {
        const expected = Math.min(buffer.length, size - offset);
        let read = 0;
        while (read < expected) {
          const received = readSync(fd, buffer, read, expected - read, offset + read);
          if (received === 0) incomplete();
          read += received;
        }
        const bytes = buffer.subarray(0, read);
        if (position === 0) {
          mime = imageMime(bytes);
          // Provisional checksum is transaction-local and never published.
          insertAsset.run(id, uri, mime, size, "0".repeat(64), Math.ceil(size / MEDIA_CHUNK_BYTES));
        }
        hash.update(bytes); insertChunk.run(id, position, bytes);
        offset += read; position++;
        progress(options, "EMBEDDED", offset, size);
      }
      const after = fstatSync(fd, { bigint: true });
      if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || mime === null) incomplete();
      db.prepare(`UPDATE ${MEDIA_TABLE} SET sha256=? WHERE id=?`).run(hash.digest("hex"), id);
    } finally { closeSync(fd); }
  }
  return descriptorDigest(descriptors(db));
}

/** Validate lengths BEFORE fetching BLOBs, then stream chunks. Malformed copies cannot force
 * a single huge BLOB into JS memory. No old media path is opened during validation/restore. */
function visitChunks(db: DatabaseSync, row: MediaRow, visit: (bytes: Uint8Array) => void): void {
  const layouts = db.prepare(`SELECT position, length(data) AS bytes, typeof(data) AS kind FROM ${MEDIA_CHUNKS} WHERE media_id=? ORDER BY position`);
  let count = 0; let size = 0;
  for (const chunk of layouts.iterate(row.id)) {
    const expected = Math.min(MEDIA_CHUNK_BYTES, row.byte_length - size);
    if (chunk.position !== count || chunk.kind !== "blob" || chunk.bytes !== expected || expected <= 0) invalid();
    count++; size += expected;
  }
  if (count !== row.chunk_count || size !== row.byte_length) invalid();
  const read = db.prepare(`SELECT data FROM ${MEDIA_CHUNKS} WHERE media_id=? AND position=?`);
  const hash = createHash("sha256");
  for (let position = 0; position < count; position++) {
    const bytes = read.get(row.id, position)?.data;
    if (!(bytes instanceof Uint8Array)) invalid();
    if (position === 0 && imageMime(bytes) !== row.mime) invalid();
    hash.update(bytes); visit(bytes);
  }
  if (hash.digest("hex") !== row.sha256) invalid();
}
export function verifyRecipePhotos(db: DatabaseSync, summary: SnapshotMediaSummary | undefined): void {
  const refs = recipePhotoReferences(db);
  if (!summary) {
    if (refs.length > 0) incomplete();
    return;
  }
  const uris = new Set(refs.map((row) => row.sourceUri));
  for (const row of descriptors(db)) {
    if (typeof row.id !== "string" || !shaPattern.test(row.id) || !fileUri(row.source_uri) || row.id !== shaText(row.source_uri) ||
      !shaPattern.test(row.sha256) || !mimes.includes(row.mime) || checkedBytes(row.byte_length) === 0 || checkedBytes(row.chunk_count) === 0 ||
      !uris.delete(row.source_uri)) invalid();
    visitChunks(db, row, () => undefined);
  }
  if (uris.size > 0 || JSON.stringify(descriptorDigest(descriptors(db))) !== JSON.stringify(summary)) invalid();
}

function diskDigest(file: string): { sha256: string; size: number; mime: ImageMime } {
  const fd = openSync(file, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) invalid();
    const hash = createHash("sha256"); const buffer = Buffer.alloc(MEDIA_CHUNK_BYTES);
    let size = 0; let mime: ImageMime | null = null;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const bytes = buffer.subarray(0, read);
      if (mime === null) mime = imageMime(bytes);
      hash.update(bytes); size += read;
    }
    if (mime === null) invalid();
    return { sha256: hash.digest("hex"), size, mime };
  } finally { closeSync(fd); }
}
/** Extract into new private filenames before switching DB. Old files are never removed.
 * A process killed during extraction leaves only an unreferenced .partial file. */
export function extractRecipePhotos(db: DatabaseSync, backupId: string, options: SnapshotMediaOptions = {}): readonly RestoredRecipePhoto[] {
  const references = recipePhotoReferences(db);
  if (references.length === 0) return [];
  const root = rootPath(options.mediaRoot);
  const restoreId = options.restoreId ?? randomUUID();
  if (!uuidPattern.test(backupId) || !uuidPattern.test(restoreId)) invalid();
  const restored = new Map<string, string>();
  for (const row of descriptors(db)) {
    const filename = `restore-${restoreId}-${row.id}.${extension[row.mime]}`;
    const target = join(root, filename);
    if (!confined(root, target)) invalid();
    if (existsSync(target)) {
      const file = realpathSync(target);
      if (!confined(root, file)) invalid();
      const found = diskDigest(file);
      if (found.sha256 !== row.sha256 || found.size !== row.byte_length || found.mime !== row.mime) invalid();
    } else {
      const partial = join(root, `${filename}.${randomUUID()}.partial`);
      const fd = openSync(partial, "wx", 0o600);
      let completed = 0;
      try {
        visitChunks(db, row, (bytes) => {
          let written = 0;
          while (written < bytes.length) {
            const count = writeSync(fd, bytes, written, bytes.length - written);
            if (count === 0) throw new SnapshotError("SNAPSHOT_IO_FAILED");
            written += count;
          }
          completed += bytes.length;
          progress(options, "WRITING", completed, row.byte_length);
        });
        fsyncSync(fd);
      } finally { closeSync(fd); }
      const found = diskDigest(partial);
      if (found.sha256 !== row.sha256 || found.size !== row.byte_length || found.mime !== row.mime) invalid();
      linkSync(partial, target);
      progress(options, "PUBLISHED", row.byte_length, row.byte_length);
      try { unlinkSync(partial); } catch { /* Reclaim only private orphan later; published bytes are verified. */ }
    }
    restored.set(row.source_uri, pathToFileURL(target).href);
  }
  return references.map((row) => {
    const restoredUri = restored.get(row.sourceUri);
    if (restoredUri === undefined) invalid();
    return { ...row, restoredUri };
  });
}

/** Only the local media URI may differ. Hash the original exact JSON bytes after proving
 * the stored JSON is semantically identical except for that intentional relocation. */
export function originalPhotoJsonForParity(value: unknown, photo: RestoredRecipePhoto): string {
  if (typeof value !== "string") invalid();
  const before = JSON.parse(photo.originalJson) as Record<string, unknown>;
  const after = JSON.parse(value) as Record<string, unknown>;
  if (JSON.stringify(after) !== JSON.stringify({ ...before, photoUri: photo.restoredUri })) invalid();
  return photo.originalJson;
}
