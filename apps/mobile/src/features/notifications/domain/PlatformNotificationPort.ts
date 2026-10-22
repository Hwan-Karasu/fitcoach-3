export type OsPermission = "granted" | "denied" | "undetermined";

/** Граница с Android: только то, что нужно напоминаниям календаря. Rest Timer этим портом не управляется (§41.8). */
export interface PlatformNotificationPort {
  permission(): Promise<OsPermission>;
  /** Системный запрос; вызывается только в понятном контексте — когда тренер включает напоминание (§41.12). */
  requestPermission(): Promise<OsPermission>;
  /** Идентификаторы запланированных напоминаний FitCoach (чужие уведомления, в том числе таймер отдыха, не возвращаются). */
  scheduledIds(): Promise<readonly string[]>;
  schedule(request: Readonly<{ identifier: string; title: string; body: string; fireAt: Date }>): Promise<void>;
  cancel(identifiers: readonly string[]): Promise<void>;
  openSystemSettings(): Promise<void>;
}
