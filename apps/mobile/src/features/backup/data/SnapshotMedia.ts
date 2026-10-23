import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { SnapshotError, type SnapshotMediaSummary } from "../domain/SnapshotManifest.ts";
import { MEDIA_CHUNK_BYTES, MEDIA_CHUNKS, MEDIA_TABLE } from "./SnapshotCatalog.ts";
import { IMAGE_EXTENSION, IMAGE_MIMES, imageMime, isLocalImageUri,
  type ImageMime, type RecipePhotoReference, type RestoredRecipePhoto } from "./SnapshotPhotoRules.ts";
import { snapshotMediaProgress, type SnapshotMediaSettings } from "./SnapshotMediaPort.ts";
import type { SnapshotSqlPort } from "./SnapshotSqlPort.ts";

interface MediaRow {
  readonly id: string;
  readonly source_uri: string;
  readonly mime: ImageMime;
  readonly byte_length: number;
  readonly sha256: string;
  readonly chunk_count: number;
}
function invalid(): never { throw new SnapshotError("SNAPSHOT_INVALID"); }
function incomplete(): never { throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA"); }
const shaText = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));
const shaPattern = /^[a-f0-9]{64}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function descriptors(db: SnapshotSqlPort): AsyncIterable<MediaRow> {
  return db.each<MediaRow>(`SELECT id, source_uri, mime, byte_length, sha256, chunk_count FROM ${MEDIA_TABLE} ORDER BY id`);
}
async function descriptorDigest(rows: AsyncIterable<MediaRow>): Promise<SnapshotMediaSummary> {
  const hash = sha256.create(); let bytes = 0; let entries = 0;
  try {
    hash.update(utf8ToBytes("athlete-snapshot-media-v1\n"));
    for await (const row of rows) {
      hash.update(utf8ToBytes(`${JSON.stringify([row.id, row.source_uri, row.mime, row.byte_length, row.sha256, row.chunk_count])}\n`));
      bytes = safeCount(bytes + row.byte_length); entries = safeCount(entries + 1);
    }
    return { version: 1, entries, bytes, sha256: bytesToHex(hash.digest()) };
  } finally { hash.destroy(); }
}
/** Includes archived recipes. Missing/corrupt media blocks an incomplete backup. */
export async function recipePhotoReferences(db: SnapshotSqlPort): Promise<readonly RecipePhotoReference[]> {
  const result: RecipePhotoReference[] = [];
  for await (const row of db.each<{ id: string; details_json: string }>("SELECT id, details_json FROM recipes WHERE details_json IS NOT NULL ORDER BY id")) {
    if (typeof row.id !== "string" || typeof row.details_json !== "string") invalid();
    let value: unknown;
    try { value = JSON.parse(row.details_json); } catch { return invalid(); }
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const uri = (value as Record<string, unknown>).photoUri;
    if (uri === null || uri === undefined) continue;
    if (!isLocalImageUri(uri)) incomplete();
    result.push({ id: row.id, originalJson: row.details_json, sourceUri: uri });
  }
  return result;
}
/** The caller owns the private snapshot's metadata transaction. */
export async function embedRecipePhotos(db: SnapshotSqlPort, settings: SnapshotMediaSettings): Promise<SnapshotMediaSummary> {
  const uris = [...new Set((await recipePhotoReferences(db)).map((row) => row.sourceUri))].sort();
  for (const uri of uris) {
    if (!settings.files) incomplete();
    const reader = await settings.files.openSource(uri);
    const hash = sha256.create();
    try {
      const size = safeCount(reader.size);
      if (size === 0) incomplete();
      const id = shaText(uri); let offset = 0; let position = 0;
      while (offset < size) {
        const expected = Math.min(MEDIA_CHUNK_BYTES, size - offset);
        const bytes = new Uint8Array(expected); let received = 0;
        while (received < expected) {
          const chunk = await reader.read(expected - received);
          if (chunk.length === 0 || chunk.length > expected - received) incomplete();
          bytes.set(chunk, received); received += chunk.length;
        }
        if (position === 0) {
          await db.run(`INSERT INTO ${MEDIA_TABLE} (id, source_uri, mime, byte_length, sha256, chunk_count) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, uri, imageMime(bytes), size, "0".repeat(64), Math.ceil(size / MEDIA_CHUNK_BYTES)]);
        }
        hash.update(bytes);
        await db.run(`INSERT INTO ${MEDIA_CHUNKS} (media_id, position, data) VALUES (?, ?, ?)`, [id, position, bytes]);
        position++; offset += bytes.length;
        snapshotMediaProgress(settings, "EMBEDDED", offset, size);
      }
      if ((await reader.read(1)).length !== 0) incomplete();
      await reader.assertUnchanged();
      await db.run(`UPDATE ${MEDIA_TABLE} SET sha256=? WHERE id=?`, [bytesToHex(hash.digest()), id]);
    } finally { hash.destroy(); reader.close(); }
  }
  return descriptorDigest(descriptors(db));
}
/** Check lengths without loading BLOBs first. Each fetched BLOB is capped at 256 KiB. */
async function visitChunks(db: SnapshotSqlPort, row: MediaRow, visit: (bytes: Uint8Array) => Promise<void>): Promise<void> {
  let count = 0; let size = 0;
  for await (const chunk of db.each<{ position: number; bytes: number; kind: string }>(
    `SELECT position, length(data) AS bytes, typeof(data) AS kind FROM ${MEDIA_CHUNKS} WHERE media_id=? ORDER BY position`, [row.id])) {
    const expected = Math.min(MEDIA_CHUNK_BYTES, row.byte_length - size);
    if (chunk.position !== count || chunk.kind !== "blob" || chunk.bytes !== expected || expected <= 0) invalid();
    count++; size += expected;
  }
  if (count !== row.chunk_count || size !== row.byte_length) invalid();
  const hash = sha256.create();
  try {
    for (let position = 0; position < count; position++) {
      const bytes = (await db.first<{ data: Uint8Array }>(`SELECT data FROM ${MEDIA_CHUNKS} WHERE media_id=? AND position=?`, [row.id, position]))?.data;
      const expected = Math.min(MEDIA_CHUNK_BYTES, row.byte_length - position * MEDIA_CHUNK_BYTES);
      if (!(bytes instanceof Uint8Array) || bytes.length !== expected) invalid();
      if (position === 0 && imageMime(bytes) !== row.mime) invalid();
      hash.update(bytes); await visit(bytes);
    }
    if (bytesToHex(hash.digest()) !== row.sha256) invalid();
  } finally { hash.destroy(); }
}
export async function verifyRecipePhotos(db: SnapshotSqlPort, summary: SnapshotMediaSummary | undefined): Promise<void> {
  const refs = await recipePhotoReferences(db);
  if (!summary) { if (refs.length > 0) incomplete(); return; }
  const uris = new Set(refs.map((row) => row.sourceUri));
  for await (const row of descriptors(db)) {
    if (typeof row.id !== "string" || !shaPattern.test(row.id) || !isLocalImageUri(row.source_uri) || row.id !== shaText(row.source_uri) ||
      typeof row.sha256 !== "string" || !shaPattern.test(row.sha256) || !IMAGE_MIMES.includes(row.mime) ||
      safeCount(row.byte_length) === 0 || safeCount(row.chunk_count) === 0 || !uris.delete(row.source_uri)) invalid();
    await visitChunks(db, row, async () => undefined);
  }
  if (uris.size > 0 || JSON.stringify(await descriptorDigest(descriptors(db))) !== JSON.stringify(summary)) invalid();
}
/** The source URI is never opened on restore. Only generated private names are published. */
export async function extractRecipePhotos(db: SnapshotSqlPort, backupId: string, settings: SnapshotMediaSettings): Promise<readonly RestoredRecipePhoto[]> {
  const refs = await recipePhotoReferences(db);
  if (refs.length === 0) return [];
  if (!settings.files) incomplete();
  const restoreId = settings.restoreId;
  if (!uuidPattern.test(backupId) || typeof restoreId !== "string" || !uuidPattern.test(restoreId)) invalid();
  const restored = new Map<string, string>();
  for await (const row of descriptors(db)) {
    let completed = 0;
    const restoredUri = await settings.files.publishVerified(`restore-${restoreId}-${row.id}.${IMAGE_EXTENSION[row.mime]}`,
      { bytes: row.byte_length, sha256: row.sha256, mime: row.mime }, async (append) => {
        await visitChunks(db, row, async (bytes) => {
          await append(bytes); completed += bytes.length;
          snapshotMediaProgress(settings, "WRITING", completed, row.byte_length);
        });
      });
    if (!isLocalImageUri(restoredUri)) invalid();
    snapshotMediaProgress(settings, "PUBLISHED", row.byte_length, row.byte_length);
    restored.set(row.source_uri, restoredUri);
  }
  return refs.map((row) => {
    const restoredUri = restored.get(row.sourceUri);
    if (restoredUri === undefined) return invalid();
    return { ...row, restoredUri };
  });
}
