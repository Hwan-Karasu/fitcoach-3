/** Host replacement of Expo IO only; the real backup driver/engine execute unchanged. */
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readSync, writeSync, statSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/** `queries` collects every SELECT/PRAGMA the driver sends (all + first), so tests can count hash passes and integrity checks. */
export const backupBoundary = { root: "", queries: [] as string[], copies: 0, fullDisk: false, freeBytes: Number.MAX_SAFE_INTEGER, picked: null as File | null, native: null as unknown };
const path = (value: string | { uri: string }) => {
  const uri = typeof value === "string" ? value : value.uri;
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
};
export class Directory {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) { this.uri = pathToFileURL(join(...parts.map(path))).href; }
  get exists() { return existsSync(path(this)); }
  get name() { return basename(path(this)); }
  create() { mkdirSync(path(this), { recursive: true }); }
  delete() { rmSync(path(this), { recursive: true, force: true }); }
  list(): (File | Directory)[] {
    return readdirSync(path(this), { withFileTypes: true })
      .map((entry) => entry.isDirectory() ? new Directory(path(this), entry.name) : new File(path(this), entry.name));
  }
}
export class File {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) { this.uri = pathToFileURL(join(...parts.map(path))).href; }
  get exists() { return existsSync(path(this)); }
  get size() { return statSync(path(this)).size; }
  get name() { return basename(path(this)); }
  get lastModified() { return statSync(path(this)).mtimeMs; }
  get parentDirectory() { return new Directory(dirname(path(this))); }
  create() { writeFileSync(path(this), "", { flag: "wx" }); }
  write(content: string) { writeFileSync(path(this), content); }
  async text() { return readFileSync(path(this), "utf8"); }
  delete() { rmSync(path(this), { force: true }); }
  static async pickFileAsync(): Promise<{ canceled: boolean; result: File }> {
    if (backupBoundary.picked === null) return { canceled: true, result: undefined as never };
    return { canceled: false, result: backupBoundary.picked };
  }
  async copy(destination: File) {
    if (backupBoundary.fullDisk) throw new Error("ENOSPC: no space left on device");
    backupBoundary.copies++; copyFileSync(path(this), path(destination));
  }
  open(mode: string = "r") {
    if (mode === "w") {
      const out = openSync(path(this), "w");
      return { writeBytes(bytes: Uint8Array) { writeSync(out, bytes); }, close() { closeSync(out); } };
    }
    const fd = openSync(path(this), "r"); let offset = 0;
    return { size: this.size, readBytes(length: number) {
      const bytes = new Uint8Array(length); const read = readSync(fd, bytes, 0, length, offset); offset += read;
      return bytes.subarray(0, read);
    }, close() { closeSync(fd); } };
  }
}
export const FileMode = { ReadOnly: "r", WriteOnly: "w" };
export const Paths = {
  get document() { return new Directory(backupBoundary.root); },
  get availableDiskSpace() { return backupBoundary.freeBytes; },
};
export const Platform = { OS: "android" };
export const uuid = { v4: randomUUID };
/** Подставной нативный модуль AthleteBackupStorage (по умолчанию его нет, как в Expo Go). */
export const requireOptionalNativeModule = () => backupBoundary.native;
export async function moveAsync({ from, to }: { from: string; to: string }) { renameSync(path(from), path(to)); }
type Binding = string | number | null | Uint8Array;
export async function openDatabaseAsync(name: string, _options: unknown, directory: string) {
  const filename = join(path(directory), name); const db = new DatabaseSync(filename);
  return { db, filename,
    async execAsync(sql: string) { db.exec(sql); },
    async getAllAsync(sql: string, args: Binding[] = []) { backupBoundary.queries.push(sql); return db.prepare(sql).all(...args); },
    async getFirstAsync(sql: string, args: Binding[] = []) { backupBoundary.queries.push(sql); return db.prepare(sql).get(...args) ?? null; },
    async *getEachAsync(sql: string, args: Binding[] = []) { for (const row of db.prepare(sql).iterate(...args)) yield row; },
    async runAsync(sql: string, args: Binding[] = []) {
      const result = db.prepare(sql).run(...args); return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async closeAsync() { db.close(); },
  };
}
export async function backupDatabaseAsync({ sourceDatabase, destDatabase }: {
  sourceDatabase: Awaited<ReturnType<typeof openDatabaseAsync>>; destDatabase: Awaited<ReturnType<typeof openDatabaseAsync>>;
}) { await backup(sourceDatabase.db, destDatabase.filename); }
