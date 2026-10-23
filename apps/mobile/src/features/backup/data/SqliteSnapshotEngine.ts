import { inspectDatabaseIdentity, type DatabaseIdentity, type DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";
import { runMigrationsInTransaction } from "../../../shared/db/MigrationRunner.ts";
import { parseSnapshotManifest, SnapshotError, type SnapshotManifest } from "../domain/SnapshotManifest.ts";
import { MANIFEST_TABLE, MEDIA_CHUNKS, MEDIA_TABLE, SNAPSHOT_LEDGER, SNAPSHOT_OWNER } from "./SnapshotCatalog.ts";
import { snapshotContentSha256 } from "./SnapshotContentHash.ts";
import { embedRecipePhotos, extractRecipePhotos, verifyRecipePhotos } from "./SnapshotMedia.ts";
import type { SnapshotMediaSettings } from "./SnapshotMediaPort.ts";
import type { SnapshotSqlPort } from "./SnapshotSqlPort.ts";

export interface SnapshotSchema {
  readonly identity: DatabaseIdentity;
  readonly owners: readonly DatabaseOwnerCatalog[];
}
/** Platform-independent .atbackup format. Callers supply a stable PRIVATE SQLite copy,
 * keep it exclusive, close it before file publication, and preserve the external source.
 * The working database must never be passed to sealSnapshot/stageSnapshot. */
export class SqliteSnapshotEngine {
  private readonly schema: SnapshotSchema;
  constructor(schema: SnapshotSchema) { this.schema = schema; }
  private async owned(db: SnapshotSqlPort, snapshot: boolean): Promise<void> {
    const owners = snapshot ? [...this.schema.owners, SNAPSHOT_OWNER] : this.schema.owners;
    if (await inspectDatabaseIdentity(db, this.schema.identity, owners) !== "OWNED") throw new SnapshotError("SNAPSHOT_INVALID");
  }
  async sealSnapshot(db: SnapshotSqlPort, metadata: Pick<SnapshotManifest, "backupId" | "createdAt">,
    settings: SnapshotMediaSettings = {}): Promise<SnapshotManifest> {
    await this.owned(db, false);
    const contentSha256 = await snapshotContentSha256(db);
    return db.transaction(async (tx) => {
      await runMigrationsInTransaction(tx, SNAPSHOT_OWNER.chain, SNAPSHOT_OWNER.ledger);
      const media = await embedRecipePhotos(tx, settings);
      const manifest = parseSnapshotManifest(JSON.stringify({ kind: "athlete-diary-snapshot", formatVersion: 3,
        product: this.schema.identity.product, workspaceId: this.schema.identity.workspaceId,
        backupId: metadata.backupId, createdAt: metadata.createdAt, contentSha256, media }), this.schema.identity.workspaceId);
      await tx.run(`INSERT INTO ${MANIFEST_TABLE} (singleton, json) VALUES (1, ?)`, [JSON.stringify(manifest)]);
      return manifest;
    });
  }
  async validateSnapshot(db: SnapshotSqlPort): Promise<SnapshotManifest> {
    await this.owned(db, true);
    const rows = await db.all<{ singleton: number; json: unknown }>(
      `SELECT singleton, CASE WHEN length(json) <= 8192 THEN json END AS json FROM ${MANIFEST_TABLE}`);
    if (rows.length !== 1 || rows[0]?.singleton !== 1) throw new SnapshotError("SNAPSHOT_INVALID");
    const manifest = parseSnapshotManifest(rows[0].json, this.schema.identity.workspaceId);
    const version = (await db.first<{ version: number }>(`SELECT max(version) AS version FROM ${SNAPSHOT_LEDGER}`))?.version;
    if ((version === 2) !== (manifest.media !== undefined)) throw new SnapshotError("SNAPSHOT_INVALID");
    await verifyRecipePhotos(db, manifest.media);
    if (await snapshotContentSha256(db) !== manifest.contentSha256) throw new SnapshotError("SNAPSHOT_INVALID");
    return manifest;
  }
  async stageSnapshot(db: SnapshotSqlPort, settings: SnapshotMediaSettings = {}): Promise<SnapshotManifest> {
    const manifest = await this.validateSnapshot(db);
    // Publish verified photos before DB changes. A failure leaves only private unreferenced media.
    const photos = await extractRecipePhotos(db, manifest.backupId, settings);
    await db.transaction(async (tx) => {
      if (manifest.media !== undefined) {
        await tx.run(`DROP TABLE ${MEDIA_CHUNKS}`);
        await tx.run(`DROP TABLE ${MEDIA_TABLE}`);
      }
      await tx.run(`DROP TABLE ${MANIFEST_TABLE}`);
      await tx.run(`DROP TABLE ${SNAPSHOT_LEDGER}`);
      for (const photo of photos) {
        const changed = await tx.run("UPDATE recipes SET details_json=json_set(details_json, '$.photoUri', ?) WHERE id=? AND json_extract(details_json, '$.photoUri')=?",
          [photo.restoredUri, photo.id, photo.sourceUri]);
        if (changed.changes !== 1) throw new SnapshotError("SNAPSHOT_INVALID");
      }
      await this.owned(tx, false);
      if (await snapshotContentSha256(tx, photos) !== manifest.contentSha256) throw new SnapshotError("SNAPSHOT_INVALID");
    });
    return manifest;
  }
}
