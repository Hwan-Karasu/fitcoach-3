/** Host replacement of Expo IO only; the real backup driver/engine execute unchanged. */
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readSync, statSync, writeFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export const backupBoundary = { root: "", queries: [] as string[], copies: 0, fullDisk: false };
const path = (value: string | { uri: string }) => {
  const uri = typeof value === "string" ? value : value.uri;
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
};
export class Directory {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) { this.uri = pathToFileURL(join(...parts.map(path))).href; }
  create() { mkdirSync(path(this), { recursive: true }); }
}
export class File {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) { this.uri = pathToFileURL(join(...parts.map(path))).href; }
  get exists() { return existsSync(path(this)); }
  get size() { return statSync(path(this)).size; }
  get name() { return basename(path(this)); }
  get parentDirectory() { return new Directory(dirname(path(this))); }
  create() { writeFileSync(path(this), "", { flag: "wx" }); }
  async copy(destination: File) {
    if (backupBoundary.fullDisk) throw new Error("ENOSPC: no space left on device");
    backupBoundary.copies++; copyFileSync(path(this), path(destination));
  }
  open() {
    const fd = openSync(path(this), "r"); let offset = 0;
    return { size: this.size, readBytes(length: number) {
      const bytes = new Uint8Array(length); const read = readSync(fd, bytes, 0, length, offset); offset += read;
      return bytes.subarray(0, read);
    }, close() { closeSync(fd); } };
  }
}
export const FileMode = { ReadOnly: "r" };
export const Paths = { get document() { return new Directory(backupBoundary.root); } };
export const Platform = { OS: "android" };
export const uuid = { v4: randomUUID };
export const requireOptionalNativeModule = () => null;
export async function moveAsync({ from, to }: { from: string; to: string }) { renameSync(path(from), path(to)); }
type Binding = string | number | null | Uint8Array;
export async function openDatabaseAsync(name: string, _options: unknown, directory: string) {
  const filename = join(path(directory), name); const db = new DatabaseSync(filename);
  return { db, filename,
    async execAsync(sql: string) { db.exec(sql); },
    async getAllAsync(sql: string, args: Binding[] = []) { backupBoundary.queries.push(sql); return db.prepare(sql).all(...args); },
    async getFirstAsync(sql: string, args: Binding[] = []) { return db.prepare(sql).get(...args) ?? null; },
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
