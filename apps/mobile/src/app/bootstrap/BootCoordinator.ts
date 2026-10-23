import { resolvePalette, type ResolvedPalette, type ThemeId, type ThemePreference } from
  "../../shared/ui/theme/resolver.ts";

export type BootErrorCode =
  | "WORKSPACE_UNAVAILABLE"
  | "DB_UNAVAILABLE"
  | "DATABASE_INCOMPATIBLE"
  | "DATABASE_NEWER"
  | "MIGRATION_INCOMPLETE"
  | "RESTORE_RECOVERY_REQUIRED"
  | "PREFERENCES_UNAVAILABLE"
  | "THEME_UNAVAILABLE";

export type BootState =
  | Readonly<{ kind: "BOOT_PENDING"; attempt: number }>
  | Readonly<{ kind: "DB_READY"; attempt: number }>
  | Readonly<{ kind: "APP_READY"; attempt: number; workspaceId: string; palette: ResolvedPalette }>
  | Readonly<{ kind: "BOOT_FAILED"; attempt: number; code: BootErrorCode }>;

export interface BootDependencies {
  readonly fallbackThemeId: ThemeId;
  /** Recover any interrupted file replacement before opening/creating any workspace DB. */
  readonly recoverBeforeOpen?: () => Promise<void>;
  /** Must return only after a local trainer workspace has been identified. */
  readonly prepareWorkspace: () => Promise<{ readonly id: string }>;
  /** Must resolve only after SQLite integrity/migrations are safe for use. */
  readonly openDatabase: (workspaceId: string) => Promise<void>;
  readonly loadThemePreference: (workspaceId: string) => Promise<ThemePreference>;
  /** Non-critical work starts after APP_READY and may fail independently. */
  readonly startBackgroundServices?: (workspaceId: string) => Promise<void>;
  readonly reportBackgroundFailure?: (code: "BACKGROUND_SERVICE_FAILED") => void;
}

export class BootGateError extends Error {
  readonly code: BootErrorCode;

  constructor(code: BootErrorCode) {
    super(code);
    this.name = "BootGateError";
    this.code = code;
  }
}

export class BootCoordinator {
  private readonly dependencies: BootDependencies;
  private current: BootState = { kind: "BOOT_PENDING", attempt: 0 };
  private inFlight: Promise<BootState> | null = null;
  private listeners = new Set<(state: BootState) => void>();

  constructor(dependencies: BootDependencies) { this.dependencies = dependencies; }

  get state(): BootState { return this.current; }

  subscribe(listener: (state: BootState) => void): () => void {
    this.listeners.add(listener);
    try { listener(this.current); }
    catch { /* An observer cannot block the critical boot gate. */ }
    return () => { this.listeners.delete(listener); };
  }

  start(): Promise<BootState> {
    if (this.current.kind === "APP_READY" || this.current.kind === "BOOT_FAILED") {
      return Promise.resolve(this.current);
    }
    if (this.inFlight !== null) return this.inFlight;
    return this.runAttempt();
  }

  retry(): Promise<BootState> {
    if (this.current.kind !== "BOOT_FAILED") return this.start();
    return this.runAttempt();
  }

  private runAttempt(): Promise<BootState> {
    const attempt = this.current.attempt + 1;
    const running = Promise.resolve().then(() => this.runCritical(attempt));
    this.inFlight = running;
    this.publish({ kind: "BOOT_PENDING", attempt });
    void running.finally(() => {
      if (this.inFlight === running) this.inFlight = null;
    });
    return running;
  }

  private async runCritical(attempt: number): Promise<BootState> {
    let stage: BootErrorCode = "RESTORE_RECOVERY_REQUIRED";
    try {
      await this.dependencies.recoverBeforeOpen?.();
      stage = "WORKSPACE_UNAVAILABLE";
      const workspace = await this.dependencies.prepareWorkspace();
      if (typeof workspace.id !== "string" || workspace.id.trim().length === 0) {
        throw new BootGateError("WORKSPACE_UNAVAILABLE");
      }
      stage = "DB_UNAVAILABLE";
      await this.dependencies.openDatabase(workspace.id);
      this.publish({ kind: "DB_READY", attempt });
      stage = "PREFERENCES_UNAVAILABLE";
      const preference = await this.dependencies.loadThemePreference(workspace.id);
      stage = "THEME_UNAVAILABLE";
      const palette = resolvePalette(preference, this.dependencies.fallbackThemeId);
      const ready: BootState = { kind: "APP_READY", attempt, workspaceId: workspace.id, palette };
      this.publish(ready);
      this.startBackground(workspace.id);
      return ready;
    } catch (error) {
      const failed: BootState = {
        kind: "BOOT_FAILED", attempt,
        code: error instanceof BootGateError ? error.code : stage,
      };
      this.publish(failed);
      return failed;
    }
  }

  private startBackground(workspaceId: string): void {
    const start = this.dependencies.startBackgroundServices;
    if (!start) return;
    void Promise.resolve().then(() => start(workspaceId))
      .catch(() => {
        try { this.dependencies.reportBackgroundFailure?.("BACKGROUND_SERVICE_FAILED"); }
        catch { /* Diagnostics must never invalidate an already ready boot. */ }
      });
  }

  private publish(state: BootState): void {
    this.current = state;
    for (const listener of this.listeners) {
      try { listener(state); }
      catch { /* A faulty view subscriber must not turn APP_READY into BOOT_FAILED. */ }
    }
  }
}
