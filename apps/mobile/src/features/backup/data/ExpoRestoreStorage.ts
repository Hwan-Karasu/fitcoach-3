import { Directory, File, FileMode, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import type { RestoreGuard, RestoreSlot, RestoreStorage } from "../domain/RestoreStorage.ts";

export interface ExpoRestoreStorageOptions {
  readonly live: File;
  readonly directory: Directory;
  readonly withClosedDatabase: RestoreStorage["withClosedDatabase"];
  readonly inspectDatabase: (reader: SqliteStatementPort) => Promise<"NEW" | "OWNED">;
}
/** R06 native candidate, not connected to normal runtime. File operations are restricted
 * to preconfigured app-private persistent storage; external SAF sources are copied separately.
 * Android legacy moveAsync uses File.renameTo and fails without a copy/delete fallback.
 * Process-death/durability still needs device proof; this is not a power-loss fsync guarantee.
 */
export class ExpoRestoreStorage implements RestoreStorage {
  private readonly options: ExpoRestoreStorageOptions;
  private active = false;
  constructor(options: ExpoRestoreStorageOptions) {
    if (Platform.OS !== "android") throw new Error("RESTORE_PLATFORM_UNSUPPORTED");
    this.options = options;
    this.assertPrivate(options.live.uri);
    this.assertPrivate(options.directory.uri);
  }
  file(slot: RestoreSlot): File {
    return slot === "LIVE" ? this.options.live : new File(this.options.directory, `${slot.toLowerCase()}.db`);
  }
  private guard(): File { return new File(this.options.directory, "guard.json"); }
  async withClosedDatabase<T>(task: () => Promise<T>): Promise<T> {
    return this.options.withClosedDatabase(async () => {
      if (this.active) throw new Error("RESTORE_STORAGE_BUSY");
      this.active = true;
      try {
        this.options.directory.create({ idempotent: true, intermediates: true });
        for (const slot of ["LIVE", "INCOMING", "SAFETY", "PREVIOUS", "REJECTED", "ROLLBACK"] as const) {
          for (const suffix of ["-wal", "-shm", "-journal"]) {
            if (new File(`${this.file(slot).uri}${suffix}`).exists) throw new Error("RESTORE_SIDECAR_PRESENT");
          }
        }
        return await task();
      } finally { this.active = false; }
    });
  }
  async loadGuard(): Promise<unknown | null> {
    this.assertActive();
    const guard = this.guard();
    if (!guard.exists) return null;
    if (guard.size > 8192) throw new Error("RESTORE_GUARD_INVALID");
    return JSON.parse(await guard.text()) as unknown;
  }
  async saveGuard(guard: RestoreGuard): Promise<void> {
    this.assertActive();
    const pending = new File(this.options.directory, "guard.json.next");
    pending.write(JSON.stringify(guard));
    // Only pending/authoritative guard may be replaced, never a database slot.
    await moveAsync({ from: pending.uri, to: this.guard().uri });
  }
  async sha256(slot: RestoreSlot): Promise<string | null> {
    this.assertActive();
    const file = this.file(slot);
    return file.exists ? (await expoFileSha256(file)).sha256 : null;
  }
  async validateDatabase(slot: RestoreSlot): Promise<void> {
    this.assertActive();
    const file = this.file(slot);
    if (!file.exists || file.size < 100) throw new Error("RESTORE_DATABASE_INVALID");
    const reader = file.open(FileMode.ReadOnly);
    try {
      const bytes = reader.readBytes(16);
      const magic = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
      if (bytes.length !== 16 || magic.some((byte, index) => bytes[index] !== byte)) throw new Error("RESTORE_DATABASE_INVALID");
    } finally { reader.close(); }
    // Expo has no SQLITE_OPEN_READONLY option. Only private slots may be opened here.
    const db = await SQLite.openDatabaseAsync(file.name, { useNewConnection: true }, file.parentDirectory.uri);
    try {
      await db.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON");
      const statements: SqliteStatementPort = {
        run: async () => { throw new Error("RESTORE_VALIDATOR_READ_ONLY"); },
        first: <Row>(sql: string, bindings = []) => db.getFirstAsync<Row>(sql, [...bindings]),
        all: <Row>(sql: string, bindings = []) => db.getAllAsync<Row>(sql, [...bindings]),
      };
      if (await this.options.inspectDatabase(statements) !== "OWNED") throw new Error("RESTORE_DATABASE_INVALID");
    } finally { await db.closeAsync(); }
  }
  async copyExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void> {
    this.assertActive();
    const target = this.file(to);
    if (target.exists) throw new Error("RESTORE_DESTINATION_EXISTS");
    await this.file(from).copy(target);
  }
  async moveExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void> {
    this.assertActive();
    const target = this.file(to);
    if (target.exists) throw new Error("RESTORE_DESTINATION_EXISTS");
    await moveAsync({ from: this.file(from).uri, to: target.uri });
  }
  private assertActive(): void { if (!this.active) throw new Error("RESTORE_DATABASE_NOT_CLOSED"); }
  private assertPrivate(uri: string): void {
    const root = Paths.document.uri.replace(/\/$/u, "");
    const decoded = decodeURIComponent(uri);
    if (!uri.startsWith(`${root}/`) || /(?:^|\/)\.\.?(?:\/|$)/u.test(decoded) || /[?#\\]/u.test(decoded)) {
      throw new Error("RESTORE_PRIVATE_PATH_REQUIRED");
    }
  }
}
