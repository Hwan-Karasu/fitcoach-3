import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { BackupStorageError, SnapshotError, type BackupDestination, type PublishedBackup } from "../../features/backup/public.ts";
import { nativeBackupPublisher } from "../../features/backup/data/NativeBackupPublisher.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { expoSnapshotMedia } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { createLocalRepositories } from "./createLocalRepositories.ts";
import systemCatalogJson from "../../features/exercises/data/system-catalog.generated.json";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import { inspectProductionDatabase, prepareProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";

const STAMP = "2000-01-01T00:00:00.000Z";
const CLIENT = "R06 SYNTHETIC PUBLICATION";
const RECIPE = "R06 SYNTHETIC PUBLICATION RECIPE";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=";
const destinationFile = () => new File(Paths.document, "r06-publication-directory.json");
const driver = () => new ExpoSqliteBackup({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
const databaseAt = (root: Directory, name: string) => new SharedSqliteDatabase(() => openIsolatedSqliteConnection(
  () => SQLite.openDatabaseAsync(name, { useNewConnection: true }, root.uri), inspectProductionDatabase));
const repositories = (database: SharedSqliteDatabase) => createLocalRepositories(database, PRODUCTION_WORKSPACE_ID, systemCatalogJson as SystemCatalog);

async function externalDigest(source: File, root: Directory) {
  // Expo File.open supports private/SAF files, not generic MediaStore content URIs.
  // Read the provider into a fresh private file, then use the independent JS hash.
  const copy = new File(root, `readback-${uuid.v4()}.atbackup`);
  try { await source.copy(copy); return await expoFileSha256(copy); }
  finally { if (copy.exists) copy.delete(); }
}

export interface R06PublicationReport {
  readonly kind: "R06_PUBLICATION";
  readonly destination: "DOWNLOADS" | "DIRECTORY" | "PICKED_FILE";
  readonly checks: readonly { readonly name: string; readonly passed: boolean }[];
  readonly allPassed: boolean;
  readonly elapsedMs: number;
  readonly filename?: string;
  readonly sha256?: string;
  readonly bytes?: number;
}
function recorder(destination: R06PublicationReport["destination"]) {
  const started = Date.now(); const checks: { name: string; passed: boolean }[] = [];
  return { check(name: string, passed: boolean) {
    checks.push({ name, passed }); if (!passed) throw new Error("R06_PUBLICATION_CHECK_FAILED");
  }, report(copy?: PublishedBackup, complete = false): R06PublicationReport {
    return { kind: "R06_PUBLICATION", destination, checks, allPassed: complete && checks.every(({ passed }) => passed), elapsedMs: Date.now() - started,
      ...(copy ? { filename: copy.filename, sha256: copy.sha256, bytes: copy.bytes } : {}) };
  } };
}
export async function chooseR06PublicationDirectory(): Promise<void> {
  const selected = await Directory.pickDirectoryAsync();
  destinationFile().write(JSON.stringify({ version: 1, kind: "DIRECTORY", uri: selected.uri }));
}
/** Only the explicit test picker writes this private setting. A second process reuses
 * its saved SAF grant instead of opening another picker. Never a production location. */
export async function savedR06PublicationDirectory(): Promise<BackupDestination> {
  const file = destinationFile();
  if (!file.exists || file.size > 16384) throw new Error("R06_TEST_DIRECTORY_MISSING");
  const value = JSON.parse(await file.text()) as { version?: unknown; kind?: unknown; uri?: unknown };
  if (value.version !== 1 || value.kind !== "DIRECTORY" || typeof value.uri !== "string" || !value.uri.startsWith("content://")) throw new Error("R06_TEST_DIRECTORY_INVALID");
  return { kind: "DIRECTORY", uri: value.uri };
}

async function verifyExternal(source: File, root: Directory, check: (name: string, passed: boolean) => void): Promise<void> {
  const staging = new File(root, "restored.db"); const images = new Directory(root, "restored-images");
  const manifest = await driver().prepareForRestore(source, new File(root, "inspection.atbackup"), staging,
    { files: expoSnapshotMedia(images), restoreId: uuid.v4() });
  check("published_snapshot_manifest_and_media_valid", manifest.createdAt === STAMP && manifest.media?.entries === 1);
  const db = databaseAt(root, staging.name); const owners = repositories(db);
  try {
    await owners.initialize();
    check("all_fifteen_repository_holders_open_the_restored_file", owners.ownerCount === 15);
    const clients = await owners.clients.list("ACTIVE");
    check("client_restored_from_external_copy", clients.length === 1 && clients[0]?.displayName === CLIENT);
    const recipes = await owners.nutrition.recipes.search();
    check("recipe_restored_from_external_copy", recipes.length === 1 && recipes[0]?.name === RECIPE);
    const photoUri = recipes[0]?.details?.photoUri;
    check("photo_relocated_to_new_private_directory", typeof photoUri === "string" && photoUri.startsWith(images.uri));
    const expected = new File(root, "known-fixture.png"); expected.write(PNG, { encoding: "base64" });
    const actual = await expoFileSha256(new File(photoUri!)); const fixture = await expoFileSha256(expected);
    check("restored_photo_has_exact_known_bytes", actual.sha256 === fixture.sha256 && actual.bytes === fixture.bytes);
  } finally { await owners.close(); }
}

/** Isolated spike only. Creates one synthetic public backup with a recognisable year-2000
 * filename. It never enumerates, restores or removes another application's files. */
export async function runR06PublicationProbe(destination: BackupDestination): Promise<R06PublicationReport> {
  const r = recorder(destination.kind); const publisher = nativeBackupPublisher();
  r.check("native_publication_module_present", publisher.available);
  if (destination.kind === "DOWNLOADS") r.check("native_downloads_supported", publisher.supportsDownloads);
  const root = new Directory(Paths.document, "r06-publication", uuid.v4()); root.create({ intermediates: true });
  const original = new Directory(root, "original"); original.create();
  const images = new Directory(original, "images"); images.create();
  const image = new File(images, "synthetic.png"); image.write(PNG, { encoding: "base64" });
  const db = databaseAt(original, "source.db"); const owners = repositories(db);
  let stage = "SOURCE";
  try {
    await prepareProductionDatabase(db); await owners.initialize();
    await owners.clients.create({ displayName: CLIENT });
    const food = await owners.nutrition.foods.create({ name: "R06 SYNTHETIC OATS", brand: null, unit: "G", amountX10: 1000,
      kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 });
    await owners.nutrition.recipes.create({ name: RECIPE, servingsX10: 10, cookedMassX10: null,
      ingredients: [{ foodId: food.id, quantityX10: 500 }], details: { prepMinutes: null, cookMinutes: 1, categories: [], steps: ["Synthetic"], photoUri: image.uri } });
    await owners.close();
    stage = "SNAPSHOT";
    const snapshot = new File(original, "synthetic.atbackup");
    const source = await SQLite.openDatabaseAsync("source.db", { useNewConnection: true }, original.uri);
    const metadata = { backupId: uuid.v4(), createdAt: STAMP };
    try { await driver().createSnapshot(source, new File(original, "snapshot.partial"), snapshot, metadata, { files: expoSnapshotMedia(images) }); }
    finally { await source.closeAsync(); }
    const digest = await expoFileSha256(snapshot); const verified = { sourceUri: snapshot.uri, ...metadata, ...digest };
    stage = "NEGATIVE_INPUTS";
    const rejects = async (name: string, task: () => Promise<unknown>, codes: readonly string[]) => {
      let rejected = false;
      try { await task(); } catch (error) { rejected = error instanceof BackupStorageError && codes.includes(error.code); }
      r.check(name, rejected);
    };
    await rejects("wrong_source_hash_rejected", () => publisher.publish({ ...verified, sha256: "0".repeat(64) }, destination), ["BACKUP_VERIFICATION_FAILED"]);
    await rejects("wrong_source_size_rejected", () => publisher.publish({ ...verified, bytes: digest.bytes + 1 }, destination), ["BACKUP_PUBLICATION_INVALID"]);
    await rejects("missing_source_rejected", () => publisher.publish({ ...verified, sourceUri: new File(original, "missing.atbackup").uri }, destination), ["BACKUP_PUBLICATION_INVALID"]);
    const invalid = new File(original, "invalid.atbackup"); invalid.write(new Uint8Array(100));
    await rejects("non_sqlite_header_rejected", () => publisher.publish({ ...verified, sourceUri: invalid.uri, bytes: 100 }, destination), ["BACKUP_PUBLICATION_INVALID"]);
    await rejects("ungranted_saf_tree_rejected", () => publisher.publish(verified,
      { kind: "DIRECTORY", uri: "content://com.android.externalstorage.documents/tree/primary%3Ar06-never-granted" }), ["BACKUP_DESTINATION_UNAVAILABLE"]);
    stage = "PUBLICATION";
    const published = await publisher.publish(verified, destination); const external = new File(published.uri);
    console.info(`R06_PUBLICATION_CREATED ${JSON.stringify(published)}`);
    r.check("public_receipt_matches_verified_file", published.sha256 === digest.sha256 && published.bytes === digest.bytes && published.uri.startsWith("content://"));
    const first = await externalDigest(external, root);
    r.check("public_file_readback_matches_source", first.sha256 === digest.sha256 && first.bytes === digest.bytes);
    await rejects("duplicate_filename_not_reported_as_new_success", () => publisher.publish(verified, destination), ["BACKUP_VERIFICATION_FAILED", "BACKUP_DESTINATION_UNAVAILABLE"]);
    r.check("existing_copy_unchanged_after_duplicate_attempt", (await externalDigest(external, root)).sha256 === first.sha256);
    r.check("private_snapshot_unchanged_after_publication", (await expoFileSha256(snapshot)).sha256 === digest.sha256);
    stage = "REMOVE_ORIGINALS";
    original.delete();
    r.check("original_database_snapshot_and_photo_removed", !original.exists);
    stage = "RESTORE_PUBLIC_FILE";
    const restored = new Directory(root, "verification"); restored.create();
    await verifyExternal(external, restored, r.check);
    r.check("external_copy_not_modified_by_restore", (await externalDigest(external, root)).sha256 === first.sha256);
    return r.report(published, true);
  } catch (error) {
    console.info(`R06_PUBLICATION_FAILURE ${JSON.stringify({ stage, code: error instanceof BackupStorageError || error instanceof SnapshotError ? error.code : "NATIVE_API_FAILED", report: r.report() })}`);
    throw error;
  } finally { await owners.close(); }
}

/** After reinstall, only an exact filename recorded by this synthetic probe is eligible.
 * Reject a different picked file before copying/opening it; personal backups are excluded. */
export async function verifyR06PickedPublication(expectedFilename: string): Promise<R06PublicationReport> {
  if (!/^athlete-diary-20000101-000000-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.atbackup$/u.test(expectedFilename)) throw new Error("R06_EXPECTED_FILENAME_INVALID");
  const picked = await File.pickFileAsync({ initialUri: "content://com.android.externalstorage.documents/document/" + encodeURIComponent("primary:Download/Дневник атлета") });
  if (picked.canceled) throw new Error("R06_TEST_PICKER_CANCELLED");
  const selected = picked.result;
  if (selected.name !== expectedFilename) throw new Error("R06_WRONG_TEST_FILE");
  const root = new Directory(Paths.document, "r06-publication-reinstall", uuid.v4()); root.create({ intermediates: true });
  const r = recorder("PICKED_FILE");
  await verifyExternal(selected, root, r.check);
  return r.report(undefined, true);
}
