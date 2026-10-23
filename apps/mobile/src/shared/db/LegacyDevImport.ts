import type { SqliteStatementPort, SqlValue } from "./SqlitePort.ts";
import type { WriterCoordinator } from "./WriterCoordinator.ts";

/**
 * D01: одноразовый перенос данных из прежнего dev-файла (таблицы `dev_*`) в новую dev-базу (те же таблицы без префикса).
 * Dev-инструмент: в production не используется — данные 2.0 попадают туда только через миграцию D03/D04.
 */
export type LegacyImportStatus = "IMPORTED" | "SKIPPED_ALREADY_DONE" | "SKIPPED_NO_LEGACY";

export interface LegacyImportResult {
  readonly status: LegacyImportStatus;
  readonly tables: number;
  readonly rows: number;
}

const MARKER = "dev_legacy_import";
const LEGACY_PREFIX = "dev_";

interface TableInfo { readonly name: string }
interface ForeignKey { readonly table: string }

async function dataTables(source: SqliteStatementPort): Promise<readonly string[]> {
  const rows = await source.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '%schema_migrations' ORDER BY name`);
  return rows.map((row) => {
    if (!/^[a-z][a-z0-9_]*$/u.test(row.name)) throw new Error("LEGACY_IMPORT_IDENTIFIER_INVALID");
    return row.name;
  });
}

/** Родители раньше потомков: порядок вставки, при котором проверки внешних ключей и триггеры видят нужные строки. */
async function insertOrder(target: SqliteStatementPort, tables: readonly string[]): Promise<readonly string[]> {
  const wanted = new Set(tables);
  const parents = new Map<string, readonly string[]>();
  for (const table of tables) {
    const keys = await target.all<ForeignKey>(`PRAGMA foreign_key_list(${table})`);
    parents.set(table, [...new Set(keys.map((key) => key.table))].filter((parent) => parent !== table && wanted.has(parent)));
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  const visit = (table: string, path: readonly string[]) => {
    if (done.has(table) || path.includes(table)) return;
    for (const parent of parents.get(table) ?? []) visit(parent, [...path, table]);
    done.add(table);
    ordered.push(table);
  };
  for (const table of tables) visit(table, []);
  return ordered;
}

export async function importLegacyDevData(target: Readonly<{ writer: WriterCoordinator; reader: SqliteStatementPort }>,
  legacy: SqliteStatementPort): Promise<LegacyImportResult> {
  await target.writer.write((tx) => tx.run(`CREATE TABLE IF NOT EXISTS ${MARKER} (id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT NOT NULL, imported_at TEXT NOT NULL)`));
  if ((await target.reader.first<{ id: number }>(`SELECT id FROM ${MARKER}`)) !== null) return { status: "SKIPPED_ALREADY_DONE", tables: 0, rows: 0 };

  const mark = (tx: SqliteStatementPort, status: LegacyImportStatus) => tx.run(`INSERT INTO ${MARKER} (id, status, imported_at) VALUES (1, ?, ?)`, [status, new Date().toISOString()]);
  const legacyTables = (await dataTables(legacy)).filter((name) => name.startsWith(LEGACY_PREFIX) && name !== MARKER && name !== "dev_boot_marker");
  if (legacyTables.length === 0) {
    await target.writer.write((tx) => mark(tx, "SKIPPED_NO_LEGACY"));
    return { status: "SKIPPED_NO_LEGACY", tables: 0, rows: 0 };
  }

  const targetTables = (await dataTables(target.reader)).filter((name) => name !== MARKER);
  let occupied = false;
  for (const table of targetTables) {
    if ((await target.reader.first<{ x: number }>(`SELECT 1 AS x FROM ${table} LIMIT 1`)) !== null) { occupied = true; break; }
  }
  if (occupied) {
    // Нельзя ни смешивать данные, ни навсегда отмечать неудавшийся импорт как завершённый.
    throw new Error("LEGACY_IMPORT_TARGET_NOT_EMPTY");
  }

  if (legacyTables.some((table) => !targetTables.includes(table.slice(LEGACY_PREFIX.length)))) {
    throw new Error("LEGACY_IMPORT_UNKNOWN_TABLE");
  }

  const copy = (await insertOrder(target.reader, targetTables)).filter((name) => legacyTables.includes(`${LEGACY_PREFIX}${name}`));
  let rows = 0;
  // Одна транзакция: либо перенесено всё и проверено, либо ничего (ошибка пробрасывается, метка не ставится — перенос повторится при следующем запуске).
  await target.writer.write(async (tx) => {
    await tx.run("PRAGMA defer_foreign_keys = ON");
    for (const table of copy) {
      const columns = (await tx.all<TableInfo>(`PRAGMA table_info(${table})`)).map((column) => column.name);
      const legacyColumns = (await legacy.all<TableInfo>(`PRAGMA table_info(${LEGACY_PREFIX}${table})`)).map((column) => column.name);
      if (columns.length !== legacyColumns.length || legacyColumns.some((column) => !columns.includes(column))) {
        throw new Error(`LEGACY_IMPORT_SCHEMA_MISMATCH:${table}`);
      }
      const source = await legacy.all<Record<string, SqlValue>>(`SELECT * FROM ${LEGACY_PREFIX}${table}`);
      for (const row of source) {
        if (columns.some((column) => {
          const value = row[column];
          return value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value) ||
            (Number.isInteger(value) && !Number.isSafeInteger(value)));
        })) throw new Error("LEGACY_IMPORT_VALUE_UNSUPPORTED");
        await tx.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column] ?? null));
        rows += 1;
      }
      const copied = await tx.all<Record<string, SqlValue>>(`SELECT * FROM ${table}`);
      const key = (row: Record<string, SqlValue>) => JSON.stringify(columns.map((column) => row[column]));
      const expected = source.map(key).sort(); const actual = copied.map(key).sort();
      if (expected.length !== actual.length || expected.some((row, i) => row !== actual[i])) throw new Error("LEGACY_IMPORT_PARITY_FAILED");
    }
    const violations = await tx.all<{ table: string }>("PRAGMA foreign_key_check");
    if (violations.length > 0) throw new Error(`LEGACY_IMPORT_FOREIGN_KEY:${violations[0]!.table}`);
    await mark(tx, "IMPORTED");
  });
  return { status: "IMPORTED", tables: copy.length, rows };
}
