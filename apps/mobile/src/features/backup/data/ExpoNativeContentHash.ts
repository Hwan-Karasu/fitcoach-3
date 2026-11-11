import { Directory, File, Paths } from "expo-file-system";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { NATIVE_HASH_FIXTURE_SHA256, NATIVE_HASH_FIXTURE_SQL } from "./NativeHashFixture.ts";
import type { NativeContentHash } from "./SnapshotSqlPort.ts";

interface NativeModule {
  contentHashProtocolVersion?(): number;
  contentSha256?(uri: string, excluded: readonly string[]): Promise<{ sha256: string; rows: number }>;
}
const PROTOCOL = 1;
/** Поиск не кэшируется: requireOptionalNativeModule сам дёшев, а кэш мешал бы подмене в тестах. */
function nativeModule(): NativeModule | null {
  try {
    const found = requireOptionalNativeModule<NativeModule>("AthleteBackupStorage");
    return found !== null && found.contentHashProtocolVersion?.() === PROTOCOL && typeof found.contentSha256 === "function" ? found : null;
  } catch { return null; }
}
/** Без путей и данных: только класс причины. */
const warn = (reason: string) => console.warn("[backup-hash]", reason);

/** Один раз за процесс: нативная реализация должна дать на золотой фикстуре (все классы значений, посчитана независимым оракулом)
 * тот же SHA-256, что JS-протокол. Иначе нативный путь отключён до перезапуска — копии считает и проверяет JS (BKP-AUDIT-1 C5). */
let selfCheck: Promise<boolean> | null = null;
/** Только для тестов: следующая проверка выполнится заново. */
export function resetNativeContentHashSelfCheck(): void { selfCheck = null; }
export function nativeContentHashSelfCheck(excluded: readonly string[]): Promise<boolean> {
  selfCheck ??= (async () => {
    const mod = nativeModule(); if (mod === null) return false;
    const directory = new Directory(Paths.document, "native-hash-selfcheck");
    let db: SQLite.SQLiteDatabase | null = null;
    try {
      directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, "fixture.db"); if (file.exists) file.delete();
      db = await SQLite.openDatabaseAsync(file.name, { useNewConnection: true }, directory.uri);
      await db.execAsync(`PRAGMA journal_mode=DELETE; ${NATIVE_HASH_FIXTURE_SQL}`);
      await db.closeAsync(); db = null;
      const result = await mod.contentSha256!(file.uri, excluded);
      const ok = result.sha256 === NATIVE_HASH_FIXTURE_SHA256;
      if (!ok) warn("NATIVE_DISABLED_MISMATCH");
      return ok;
    } catch { warn("NATIVE_DISABLED_ERROR"); return false; }
    finally {
      try { await db?.closeAsync(); } catch { /* Fixture only. */ }
      try { directory.delete(); } catch { /* Fixture only. */ }
    }
  })();
  return selfCheck;
}

/** Нативный хеш конкретного закрытого приватного файла базы или undefined, когда модуля нет (Expo Go, старая сборка). Любая
 * недоступность/ошибка — null, и вызывающий считает JS. Файл не должен иметь открытой транзакции записи. */
export function expoNativeContentHash(file: File): NativeContentHash | undefined {
  if (nativeModule() === null) return undefined;
  return {
    async sha256(excluded) {
      try {
        if (!await nativeContentHashSelfCheck(excluded)) return null;
        const result = await nativeModule()!.contentSha256!(file.uri, excluded);
        return typeof result.sha256 === "string" && /^[a-f0-9]{64}$/u.test(result.sha256) ? result.sha256 : null;
      } catch { warn("NATIVE_FAILED"); return null; }
    },
  };
}
