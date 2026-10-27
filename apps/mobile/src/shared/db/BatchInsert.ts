import type { SqlValue, SqliteStatementPort } from "./SqlitePort.ts";

/** Меньше 999: старые сборки SQLite ограничивают число параметров одного запроса. */
const PARAMETERS_PER_STATEMENT = 900;

/**
 * Вставка строк пачками. На телефоне каждый запрос проходит через мост Expo, поэтому построчная запись тысяч строк
 * (импорт книги) занимает десятки секунд; пачка из десятков строк — один обмен. Порядок строк сохраняется.
 */
export async function insertRows(tx: SqliteStatementPort, table: string, columns: readonly string[],
  rows: readonly (readonly SqlValue[])[]): Promise<void> {
  const perStatement = Math.max(1, Math.floor(PARAMETERS_PER_STATEMENT / columns.length));
  const group = `(${columns.map(() => "?").join(", ")})`;
  for (let at = 0; at < rows.length; at += perStatement) {
    const chunk = rows.slice(at, at + perStatement);
    await tx.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => group).join(", ")}`, chunk.flat());
  }
}

/** Ни один из идентификаторов не повторяется среди своих и не занят в таблице; иначе `message`. */
export async function assertIdsFree(tx: SqliteStatementPort, table: string, ids: readonly string[], message: string): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new Error(message);
  for (let at = 0; at < ids.length; at += PARAMETERS_PER_STATEMENT) {
    const chunk = ids.slice(at, at + PARAMETERS_PER_STATEMENT);
    const taken = await tx.first<{ id: string }>(`SELECT id FROM ${table} WHERE id IN (${chunk.map(() => "?").join(", ")}) LIMIT 1`, chunk);
    if (taken !== null) throw new Error(message);
  }
}
