export type RestoreActionErrorCode = "RESTORE_UNAVAILABLE" | "RESTORE_NOT_READY" | "RESTORE_BUSY" | "RESTORE_INVALID_BACKUP"
  | "RESTORE_SOURCE_UNAVAILABLE" | "RESTORE_STALE_PREVIEW" | "RESTORE_NO_SPACE" | "RESTORE_FAILED"
  | "RESTORE_POINT_UNAVAILABLE" | "RESTORE_RECOVERY_REQUIRED" | "RESTORE_NEWER_BACKUP";
/** Этапы замены данных для экрана: процент неизвестен, поэтому показывается неопределённый индикатор. */
export const RESTORE_APPLY_PHASES = ["CHECKING", "SAVING_POINT", "REPLACING"] as const;
export type RestoreApplyPhase = typeof RESTORE_APPLY_PHASES[number];
export type RestoreApplyObserver = (phase: RestoreApplyPhase) => void;
export class RestoreActionError extends Error {
  readonly code: RestoreActionErrorCode;
  /** Этап подготовки, на котором произошёл сбой (для кода на экране и журнала); без путей и данных. */
  readonly stage: string | null;
  constructor(code: RestoreActionErrorCode, stage: string | null = null) { super(code); this.code = code; this.stage = stage; }
}
export interface RestorePreview {
  readonly id: string;
  readonly kind: "RESTORE" | "RETURN";
  readonly createdAt: string;
  readonly activeClients: number;
  readonly archivedClients: number;
}
export interface ReturnPointSummary { readonly id: string; readonly createdAt: string }
export interface RestoreActionState {
  readonly preparation?: RestorePreparationProgress | null;
  readonly available: boolean;
  /** LOADING — тихая служебная работа (чтение точки возврата, сброс предпросмотра): без полосы подготовки (BKP-AUDIT-1 D3). */
  readonly phase: "IDLE" | "LOADING" | "PREPARING" | "PREVIEW" | "APPLYING" | "DELETING" | "RECOVERING" | "RECOVERY_REQUIRED";
  /** Идёт ли сейчас подготовка, отменённая кнопкой: результат будет выброшен после её завершения. */
  readonly cancelRequested?: boolean;
  /** Этап применения (проверка → точка возврата → замена); null вне применения. */
  readonly applying?: RestoreApplyPhase | null;
  readonly preview: RestorePreview | null;
  readonly point: ReturnPointSummary | null;
  readonly notice: "RESTORED" | "RETURNED" | "POINT_DELETED" | "CHECKED" | null;
  readonly error: RestoreActionErrorCode | null;
  /** Этап подготовки, на котором случился сбой (для строки «Код: … · этап» на экране). */
  readonly errorStage?: string | null;
}
export type RestoreActionOutcome = Readonly<{ kind: "UPDATED" | "CANCELLED" | "RESTORED" | "RETURNED" | "POINT_DELETED" }>
  | Readonly<{ kind: "FAILED"; code: RestoreActionErrorCode }>;
export interface RestoreActionsPort {
  readonly state: RestoreActionState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<RestoreActionOutcome>;
  chooseFile(): Promise<RestoreActionOutcome>;
  previewReturn(): Promise<RestoreActionOutcome>;
  cancelPreview(): Promise<RestoreActionOutcome>;
  /** Called only by the explicit confirmation action for the displayed preview ID. */
  confirmPreview(id: string): Promise<RestoreActionOutcome>;
  /** Called only after explicit confirmation of point deletion. */
  deletePoint(id: string): Promise<RestoreActionOutcome>;
  recover(): Promise<RestoreActionOutcome>;
}
/** Privileged composition owns all file paths, SQL, maintenance and opaque prepared jobs. */
export interface RestoreJobsPort {
  prepareFile(observe?: RestorePreparationObserver): Promise<RestorePreview | null>;
  prepareReturn(pointId: string, observe?: RestorePreparationObserver): Promise<RestorePreview>;
  apply(previewId: string, observe?: RestoreApplyObserver): Promise<"COMMITTED" | "ROLLED_BACK">;
  /** Release ephemeral preparation. Published journals, active points and LIVE media
   * remain protected; an adapter must never recursively delete a committed job here. */
  discard(previewId: string): Promise<void>;
  readPoint(): Promise<ReturnPointSummary | null>;
  deletePoint(pointId: string): Promise<void>;
  recover(): Promise<void | Readonly<{ id: string; outcome: "COMMITTED" | "ROLLED_BACK" }>>;
}
/** Includes room for SQLite media pages/indexes and guard/state publication. Actual IO
 * is still checked before switching; this estimate is never permission to delete backups. */
export function restoreSpaceRequired(liveBytes: number, mediaBytes: number, mediaEntries: number, kind: RestorePreview["kind"]): number {
  if (![liveBytes, mediaBytes, mediaEntries].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new RestoreActionError("RESTORE_NO_SPACE");
  const required = (kind === "RESTORE" ? liveBytes * 3 + mediaBytes * 2 + mediaEntries * 16384 : liveBytes) + 4 * 1024 * 1024;
  if (!Number.isSafeInteger(required)) throw new RestoreActionError("RESTORE_NO_SPACE");
  return required;
}
import type { RestorePreparationObserver, RestorePreparationProgress } from "./RestorePreparation.ts";
