import { SnapshotError } from "./SnapshotManifest.ts";

/** Этап подготовки приватного файла копии, на котором произошёл сбой (BKP-DIAG-1). Пишется в статус и показывается кодом. */
export type PrepareStage = "orphans" | "space" | "job" | "source" | "copy" | "identity" | "hash" | "seal" | "verify" | "digest";
export const PREPARE_STAGES: readonly PrepareStage[] = ["orphans", "space", "job", "source", "copy", "identity", "hash", "seal", "verify", "digest"];
export type PrepareFailureKind = "SPACE_LOW" | "MEDIA_UNAVAILABLE" | "SNAPSHOT_FAILED" | "ARCHIVE_INVALID" | "WRITE_FAILED" | "UNKNOWN";

/** Сообщения SQLite/ОС о заполненном хранилище. Текст сообщения не содержит данных клиентов, только код ошибки. */
export function isStorageFull(error: unknown): boolean {
  if (error instanceof SnapshotError) return error.code === "SNAPSHOT_SPACE_LOW";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /SQLITE_FULL|disk is full|ENOSPC|No space left on device/iu.test(message);
}

/** Прежде любой сбой подготовки показывался как «проверьте свободное место». Теперь причина — по этапу и типу ошибки:
 * снимок SQLite, фото, проверка готового файла, запись временного файла; неизвестное остаётся неизвестным. */
export function classifyPrepareFailure(stage: PrepareStage, error: unknown): PrepareFailureKind {
  if (stage === "space" || isStorageFull(error)) return "SPACE_LOW";
  if (error instanceof SnapshotError && error.code === "SNAPSHOT_INCOMPLETE_MEDIA") return "MEDIA_UNAVAILABLE";
  if (stage === "verify") return "ARCHIVE_INVALID";
  if (stage === "job" || stage === "digest") return "WRITE_FAILED";
  if (stage === "source" || stage === "copy" || stage === "identity" || stage === "hash" || stage === "seal") return "SNAPSHOT_FAILED";
  return "UNKNOWN";
}
