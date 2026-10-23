import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { SnapshotError } from "../domain/SnapshotManifest.ts";
import { SNAPSHOT_OBJECTS } from "./SnapshotCatalog.ts";
import { originalPhotoJsonForParity, type RestoredRecipePhoto } from "./SnapshotPhotoRules.ts";
import type { SnapshotSqlPort } from "./SnapshotSqlPort.ts";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Same byte protocol as the original node:crypto oracle. Integers cross the native bridge
 * as TEXT, never an imprecise JS number. REAL values retain their native IEEE double,
 * including the sign bit of negative zero; decimal printf loses that bit.
 */
export async function snapshotContentSha256(db: SnapshotSqlPort, photos: readonly RestoredRecipePhoto[] = []): Promise<string> {
  const relocated = new Map(photos.map((photo) => [photo.id, photo]));
  const hash = sha256.create();
  const text = (value: string) => hash.update(utf8ToBytes(value));
  text("athlete-snapshot-content-v1\n");
  const feed = (kind: string, value: unknown): void => {
    let tag: string; let bytes: Uint8Array;
    if (kind === "null" && value === null) { tag = "null"; bytes = new Uint8Array(0); }
    else if (kind === "integer" && typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value)) { tag = "integer"; bytes = utf8ToBytes(value); }
    else if (kind === "real" && typeof value === "number" && !Number.isNaN(value)) {
      tag = "real"; bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, false);
    } else if (kind === "text" && typeof value === "string") { tag = "text"; bytes = utf8ToBytes(value); }
    else if (kind === "blob" && value instanceof Uint8Array) { tag = "blob"; bytes = value; }
    else throw new SnapshotError("SNAPSHOT_INVALID");
    text(`${tag}:${bytes.length}:`); hash.update(bytes); text(";");
  };
  try {
    const objects = await db.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
    for (const object of objects) {
      if (SNAPSHOT_OBJECTS.has(object.name)) continue;
      for (const value of [object.type, object.name, object.tbl_name, object.sql]) feed(value === null ? "null" : "text", value);
    }
    let sinceYield = 0;
    for (const object of objects.filter((row) => row.type === "table" && !SNAPSHOT_OBJECTS.has(row.name))) {
      feed("text", object.name);
      const columns = (await db.all<{ name: string }>(`PRAGMA table_info(${quote(object.name)})`)).map((row) => row.name);
      for (const name of columns) feed("text", name);
      const fields = columns.map((name, index) => {
        const col = quote(name);
        return `typeof(${col}) AS t${index}, CASE typeof(${col}) WHEN 'integer' THEN CAST(${col} AS TEXT) ELSE ${col} END AS v${index}`;
      }).join(", ");
      const order = columns.map((name) => `${quote(name)} COLLATE BINARY`).join(", ");
      for await (const row of db.each<Record<string, unknown>>(`SELECT ${fields} FROM ${quote(object.name)} ORDER BY ${order}`)) {
        text("row:");
        const idIndex = columns.indexOf("id");
        const photo = object.name === "recipes" && idIndex >= 0 ? relocated.get(String(row[`v${idIndex}`])) : undefined;
        for (const [index, name] of columns.entries()) {
          const kind = row[`t${index}`];
          if (typeof kind !== "string") throw new SnapshotError("SNAPSHOT_INVALID");
          const value = photo && name === "details_json" ? originalPhotoJsonForParity(row[`v${index}`], photo) : row[`v${index}`];
          feed(kind, value);
        }
        if (++sinceYield >= 512) { await new Promise((resolve) => setTimeout(resolve, 0)); sinceYield = 0; }
      }
      text("end-table;");
    }
    return bytesToHex(hash.digest());
  } finally { hash.destroy(); }
}
