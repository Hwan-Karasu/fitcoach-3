import { DatabaseCompatibilityError } from "../../shared/db/DatabaseIdentity.ts";
import type { ThemePreference } from "../../shared/ui/theme/resolver.ts";
import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { PRODUCTION_WORKSPACE_ID, prepareProductionDatabase } from "../composition/productionDatabase.ts";
import { BootGateError, type BootDependencies } from "./BootCoordinator.ts";

export function createProductionBootDependencies(database: SharedSqliteDatabase, initializeRepositories: () => Promise<void>,
  loadAppearance: () => Promise<ThemePreference | null>): BootDependencies {
  return {
    fallbackThemeId: "warm-sand",
    prepareWorkspace: async () => ({ id: PRODUCTION_WORKSPACE_ID }),
    openDatabase: async (workspaceId) => {
      if (workspaceId !== PRODUCTION_WORKSPACE_ID) throw new BootGateError("WORKSPACE_UNAVAILABLE");
      try { await prepareProductionDatabase(database); }
      catch (error) {
        if (error instanceof DatabaseCompatibilityError) throw new BootGateError(error.code);
        throw new BootGateError("MIGRATION_INCOMPLETE");
      }
      try { await initializeRepositories(); }
      catch { throw new BootGateError("DB_UNAVAILABLE"); }
    },
    loadThemePreference: async () => {
      // Optional display preferences never prevent access to the diary.
      try { return await loadAppearance() ?? { themeId: null, accentId: null }; }
      catch { return { themeId: null, accentId: null }; }
    },
  };
}
