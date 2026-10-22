import { importLegacyDevData, type LegacyImportResult } from "../../shared/db/LegacyDevImport.ts";
import type { SqliteConnectionPort } from "../../shared/db/SqlitePort.ts";
import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";

/** Прежний dev-файл (таблицы `dev_*`), из которого один раз переносятся данные в новую dev-базу (D01). */
export const LEGACY_DEV_DATABASE = "fitcoach_f04_clients_dev.db";

/**
 * Одноразовый перенос данных владельца (SmokeA/B/C и др.) в новую dev-базу. Ошибка останавливает boot до засева репозиториев:
 * база остаётся пустой, перенос можно повторить. Файл открывается самим SQLite (проверка «файл существует»
 * через файловый API в Expo Go ненадёжна); если в нём нет таблиц `dev_*`, перенос заканчивается и больше не повторяется.
 */
export async function importLegacyDevDatabase(database: SharedSqliteDatabase,
  openLegacy: (name: string) => Promise<SqliteConnectionPort> = async (name) => {
    const { openExpoSqliteConnection } = await import("../../shared/db/ExpoSqliteConnection.ts");
    return openExpoSqliteConnection(name);
  }): Promise<LegacyImportResult> {
  const legacy = await openLegacy(LEGACY_DEV_DATABASE);
  try {
    const lease = await database.acquire();
    try {
      const result = await importLegacyDevData({ writer: lease.writer, reader: lease.connection }, legacy);
      console.log("[d01] перенос из прежней dev-базы:", result.status, `таблиц ${result.tables}, строк ${result.rows}`);
      return result;
    } finally {
      await database.release();
    }
  } finally {
    await legacy.close();
  }
}
