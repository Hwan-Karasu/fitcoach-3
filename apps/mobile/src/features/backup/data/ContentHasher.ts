import type { BackupObserver } from "../domain/BackupProgress.ts";
import { observeBackup } from "../domain/BackupProgress.ts";
import { SNAPSHOT_OBJECTS } from "./SnapshotCatalog.ts";
import { snapshotContentSha256 } from "./SnapshotContentHash.ts";
import type { SnapshotSqlPort } from "./SnapshotSqlPort.ts";

const EXCLUDED: readonly string[] = [...SNAPSHOT_OBJECTS];
const progressOf = (observe: BackupObserver | undefined, stage: "CONTENT" | "VERIFY") =>
  (done: number, total: number) => observeBackup(observe, stage, done, total);

/** Каноническая сумма для создания копии: нативная, если порт её даёт (самопроверка пройдена), иначе JS. Протокол байтов один и тот же. */
export async function computeContentSha256(db: SnapshotSqlPort, observe?: BackupObserver, stage: "CONTENT" | "VERIFY" = "CONTENT"): Promise<string> {
  const native = await db.nativeContent?.sha256(EXCLUDED);
  if (native !== undefined && native !== null) return native;
  return snapshotContentSha256(db, [], progressOf(observe, stage));
}

/** Проверка готовой копии. Совпадение нативной суммы с manifest принимается сразу. Несовпадение или сбой native НЕ означают порчу:
 * вердикт «повреждена» выносит только JS-пересчёт (арбитр), поэтому ошибка нативного кода не делает рабочие копии невосстановимыми. */
export async function contentMatches(db: SnapshotSqlPort, expected: string, observe?: BackupObserver): Promise<boolean> {
  const native = await db.nativeContent?.sha256(EXCLUDED);
  if (native !== undefined && native !== null && native === expected) return true;
  return await snapshotContentSha256(db, [], progressOf(observe, "VERIFY")) === expected;
}
