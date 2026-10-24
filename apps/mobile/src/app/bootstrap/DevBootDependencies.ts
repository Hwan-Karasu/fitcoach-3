import { runMigrations, type MigrationStep } from "../../shared/db/MigrationRunner.ts";
import type { SqliteConnectionPort } from "../../shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../../shared/db/WriterCoordinator.ts";
import { BootGateError, type BootDependencies } from "./BootCoordinator.ts";

export const DEV_WORKSPACE_ID = "synthetic-dev-workspace";

const devCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "f03-dev-gate-v1-only",
  statements: ["CREATE TABLE dev_boot_marker (id INTEGER PRIMARY KEY CHECK (id = 1))"],
}];

/** Dev-only gate for a separate synthetic SQLite file; never a production workspace binding. */
export function createDevBootDependencies(
  openConnection: () => Promise<SqliteConnectionPort>,
  initializeClientStore?: () => Promise<void>,
): BootDependencies {
  return {
    fallbackThemeId: "warm-sand",
    prepareWorkspace: async () => ({ id: DEV_WORKSPACE_ID }),
    openDatabase: async (workspaceId) => {
      if (workspaceId !== DEV_WORKSPACE_ID) throw new BootGateError("WORKSPACE_UNAVAILABLE");
      const connection = await openConnection();
      try {
        const writer = new WriterCoordinator(connection);
        try {
          await runMigrations(writer, devCatalog);
          const marker = await connection.first<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='dev_boot_marker'",
          );
          if (marker?.name !== "dev_boot_marker") throw new Error("DEV_MARKER_MISSING");
        } catch { throw new BootGateError("MIGRATION_INCOMPLETE"); }
      } finally { await connection.close(); }
      if (initializeClientStore !== undefined) {
        try { await initializeClientStore(); }
        catch { throw new BootGateError("MIGRATION_INCOMPLETE"); }
      }
    },
    // Dev preview theme is intentionally session-only until the Settings repository exists.
    loadThemePreference: async () => ({ themeId: "warm-sand", accentId: null }),
  };
}
