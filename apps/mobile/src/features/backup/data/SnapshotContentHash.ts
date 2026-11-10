import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { SnapshotError } from "../domain/SnapshotManifest.ts";
import { SNAPSHOT_OBJECTS } from "./SnapshotCatalog.ts";
import { originalPhotoJsonForParity, type RestoredRecipePhoto } from "./SnapshotPhotoRules.ts";
import type { SnapshotSqlPort, SnapshotSqlValue } from "./SnapshotSqlPort.ts";
import { createTimeSlicer } from "../../../shared/runtime/timeSlice.ts";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Строк за одно обращение к SQLite (BKP-PERF-2): в Expo каждый вызов — переход через мост, а `each` делает его на каждую строку. */
export const CONTENT_PAGE_ROWS = 500;
export type ContentHashProgress = (done: number, total: number) => void;

/** Байты протокола копятся в одном буфере и уходят в SHA-256 крупными кусками: мелкие update на каждое значение были основной
 * ценой JS-хеша. Поток байт тот же, поэтому и значение хеша то же. */
function bufferedHash() {
  const hash = sha256.create(); const buffer = new Uint8Array(64 * 1024); let length = 0;
  const flush = () => { if (length > 0) hash.update(buffer.subarray(0, length)); length = 0; };
  const bytes = (value: Uint8Array) => {
    if (value.length > buffer.length - length) {
      flush();
      if (value.length > buffer.length) { hash.update(value); return; }
    }
    buffer.set(value, length); length += value.length;
  };
  /** Только ASCII: метки, длины, десятичные целые. */
  const ascii = (value: string) => {
    if (value.length > buffer.length - length) flush();
    if (value.length > buffer.length) { hash.update(utf8ToBytes(value)); return; }
    for (let index = 0; index < value.length; index++) buffer[length++] = value.charCodeAt(index);
  };
  return { bytes, ascii, digest: () => { flush(); return bytesToHex(hash.digest()); }, destroy: () => hash.destroy() };
}

/** A unique BINARY primary-key prefix orders rows exactly like ORDER BY every column.
 * Include composite keys: OFFSET repeatedly scanned/sorted their already-consumed rows.
 * Nullable, mixed-type, non-prefix and non-BINARY keys retain the conservative fallback. */
async function keysetMode(db: SnapshotSqlPort, table: string, columns: readonly { name: string; type: string; pk: number }[]):
  Promise<readonly ("text" | "integer")[] | null> {
  const first = columns[0];
  const count = columns.filter((column) => column.pk > 0).length;
  if (first === undefined || count === 0 || columns.slice(0, count).some((column, index) => column.pk !== index + 1)) return null;
  const prefix = columns.slice(0, count);
  const indexes = (await db.all<{ name: string; origin: string }>(`PRAGMA index_list(${quote(table)})`)).filter((row) => row.origin === "pk");
  if (indexes.length === 1) {
    const keys = (await db.all<{ name: string | null; coll: string; key: number }>(`PRAGMA index_xinfo(${quote(indexes[0]!.name)})`))
      .filter((row) => row.key === 1);
    if (keys.length !== count || keys.some((key, index) => key.name !== prefix[index]!.name || key.coll.toUpperCase() !== "BINARY")) return null;
  } else if (indexes.length !== 0 || count !== 1 || first.type.toUpperCase() !== "INTEGER") return null;
  const modes: ("text" | "integer")[] = [];
  for (const key of prefix) {
    const column = quote(key.name);
    let found = false;
    for (const mode of ["text", "integer"] as const) {
      const other = await db.first<{ count: number }>(`SELECT count(*) AS count FROM ${quote(table)} WHERE typeof(${column}) <> '${mode}'`);
      if (other?.count === 0) { modes.push(mode); found = true; break; }
    }
    if (!found) return null;
  }
  return modes;
}

/** Same byte protocol as the original node:crypto oracle. Integers cross the native bridge
 * as TEXT, never an imprecise JS number. REAL values retain their native IEEE double,
 * including the sign bit of negative zero; decimal printf loses that bit.
 */
export async function snapshotContentSha256(db: SnapshotSqlPort, photos: readonly RestoredRecipePhoto[] = [],
  progress?: ContentHashProgress): Promise<string> {
  const relocated = new Map(photos.map((photo) => [photo.id, photo]));
  const hash = bufferedHash();
  hash.ascii("athlete-snapshot-content-v1\n");
  const feed = (kind: string, value: unknown): void => {
    if (kind === "null" && value === null) hash.ascii("null:0:;");
    else if (kind === "integer" && typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value)) hash.ascii(`integer:${value.length}:${value};`);
    else if (kind === "real" && typeof value === "number" && !Number.isNaN(value)) {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, false);
      hash.ascii("real:8:"); hash.bytes(bytes); hash.ascii(";");
    } else if (kind === "text" && typeof value === "string") { const bytes = utf8ToBytes(value); hash.ascii(`text:${bytes.length}:`); hash.bytes(bytes); hash.ascii(";"); }
    else if (kind === "blob" && value instanceof Uint8Array) { hash.ascii(`blob:${value.length}:`); hash.bytes(value); hash.ascii(";"); }
    else throw new SnapshotError("SNAPSHOT_INVALID");
  };
  try {
    const objects = await db.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
    for (const object of objects) {
      if (SNAPSHOT_OBJECTS.has(object.name)) continue;
      for (const value of [object.type, object.name, object.tbl_name, object.sql]) feed(value === null ? "null" : "text", value);
    }
    const tables = objects.filter((row) => row.type === "table" && !SNAPSHOT_OBJECTS.has(row.name));
    let total = 0; let done = 0;
    if (progress) {
      for (const table of tables) total += (await db.first<{ count: number }>(`SELECT count(*) AS count FROM ${quote(table.name)}`))?.count ?? 0;
      progress(0, total);
    }
    // Порции по времени (AUTO-BACKUP-2): не дольше 8 мс работы подряд, а не 512 строк — длинные строки на Hermes держали поток.
    const slice = createTimeSlicer();
    for (const object of tables) {
      feed("text", object.name);
      const info = await db.all<{ name: string; type: string; pk: number }>(`PRAGMA table_info(${quote(object.name)})`);
      const columns = info.map((row) => row.name);
      for (const name of columns) feed("text", name);
      const fields = columns.map((name, index) => {
        const col = quote(name);
        return `typeof(${col}) AS t${index}, CASE typeof(${col}) WHEN 'integer' THEN CAST(${col} AS TEXT) ELSE ${col} END AS v${index}`;
      }).join(", ");
      const idIndex = columns.indexOf("id");
      const row = (values: Record<string, unknown>): void => {
        hash.ascii("row:");
        const photo = object.name === "recipes" && idIndex >= 0 ? relocated.get(String(values[`v${idIndex}`])) : undefined;
        for (const [index, name] of columns.entries()) {
          const kind = values[`t${index}`];
          if (typeof kind !== "string") throw new SnapshotError("SNAPSHOT_INVALID");
          feed(kind, photo && name === "details_json" ? originalPhotoJsonForParity(values[`v${index}`], photo) : values[`v${index}`]);
        }
      };
      const mode = await keysetMode(db, object.name, info);
      if (mode === null) {
        const order = columns.map((name) => `${quote(name)} COLLATE BINARY`).join(", ");
        // Composite keys and nullable/mixed keys used one native bridge roundtrip per row.
        // The private snapshot is immutable: bounded pages preserve the exact canonical order,
        // including duplicate rows and SQLite's mixed-type ordering.
        for (let offset = 0; ; offset += CONTENT_PAGE_ROWS) {
          const page = await db.all<Record<string, unknown>>(`SELECT ${fields} FROM ${quote(object.name)} ORDER BY ${order} LIMIT ${CONTENT_PAGE_ROWS} OFFSET ${offset}`);
          for (const values of page) { row(values); await slice(); }
          done += page.length; progress?.(done, total);
          if (page.length < CONTENT_PAGE_ROWS) break;
        }
      } else {
        const keys = mode.map((_, index) => `${quote(columns[index]!)} COLLATE BINARY`);
        const tuple = (values: readonly string[]) => values.length === 1 ? values[0]! : `(${values.join(", ")})`;
        const after = `${tuple(keys)} > ${tuple(mode.map((kind) => kind === "text" ? "?" : "CAST(? AS INTEGER)"))}`;
        let last: readonly SnapshotSqlValue[] | null = null;
        for (;;) {
          const page: readonly Record<string, unknown>[] = await db.all<Record<string, unknown>>(`SELECT ${fields} FROM ${quote(object.name)}${
            last === null ? "" : ` WHERE ${after}`} ORDER BY ${keys.join(", ")} LIMIT ${CONTENT_PAGE_ROWS}`, last ?? []);
          for (const values of page) { row(values); await slice(); }
          done += page.length; progress?.(done, total);
          if (page.length < CONTENT_PAGE_ROWS) break;
          last = mode.map((_, index) => {
            const next = page[page.length - 1]![`v${index}`];
            if (typeof next !== "string") throw new SnapshotError("SNAPSHOT_INVALID");
            return next;
          });
        }
      }
      hash.ascii("end-table;");
      progress?.(done, total);
    }
    return hash.digest();
  } finally { hash.destroy(); }
}
