import { DatabaseCompatibilityError } from "../../shared/db/DatabaseIdentity.ts";
import type { ThemePreference } from "../../shared/ui/theme/resolver.ts";
import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { PRODUCTION_WORKSPACE_ID, prepareProductionDatabase } from "../composition/productionDatabase.ts";
import { BootGateError, type BootDependencies } from "./BootCoordinator.ts";
import { startupDiagnostics } from "./StartupDiagnostics.ts";

/** `integrityVerifiedAtOpen` — см. `prepareProductionDatabase`: передаётся там, где соединение `database` открывается с проверкой идентичности. */
export function createProductionBootDependencies(database: SharedSqliteDatabase, initializeRepositories: () => Promise<void>,
  loadAppearance: () => Promise<ThemePreference | null>, options: Readonly<{ integrityVerifiedAtOpen?: boolean }> = {}): BootDependencies {
  return {
    fallbackThemeId: "warm-sand",
    prepareWorkspace: async () => ({ id: PRODUCTION_WORKSPACE_ID }),
    openDatabase: async (workspaceId) => {
      if (workspaceId !== PRODUCTION_WORKSPACE_ID) throw new BootGateError("WORKSPACE_UNAVAILABLE");
      // Одно соединение на весь запуск (ARCH-HARDEN-1a): без этой аренды подготовка закрывала базу, а репозитории открывали её заново —
      // второе открытие двух handle и ещё один полный проход проверки целостности.
      let held = false;
      try {
        await startupDiagnostics.measure("database.prepare", async () => {
          await database.acquire(); held = true;
          await prepareProductionDatabase(database, options);
        });
      } catch (error) {
        if (held) await database.release().catch(() => undefined);
        if (error instanceof DatabaseCompatibilityError) throw new BootGateError(error.code);
        throw new BootGateError("MIGRATION_INCOMPLETE");
      }
      try { await initializeRepositories(); }
      catch { throw new BootGateError("DB_UNAVAILABLE"); }
      // Репозитории держат свои аренды; сбой закрытия после их неудачной инициализации не подменяет исходную причину.
      finally { await database.release().catch(() => undefined); }
    },
    loadThemePreference: async () => {
      // Optional display preferences never prevent access to the diary.
      try { return await startupDiagnostics.measure("theme.load", loadAppearance) ?? { themeId: null, accentId: null }; }
      catch { return { themeId: null, accentId: null }; }
    },
  };
}
