import * as SQLite from "expo-sqlite";
import { DEFAULT_ROUTE, sanitizeSafeRoute, type SafeRoute } from "./safeRoute";

export interface RouteStore {
  database: SQLite.SQLiteDatabase;
  bootCount: number;
  savedRoute: SafeRoute;
  dataRevision: number;
}

const DATABASE_NAME = "fitcoach_r08_navigation_spike.db";

export async function openRouteStore(validClientIds: ReadonlySet<string>): Promise<RouteStore> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS spike_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  const routeRaw = await getValue(database, "safe_route");
  const parsed = parseRoute(routeRaw);
  const savedRoute = sanitizeSafeRoute(parsed, validClientIds);
  const oldBootCount = Number(await getValue(database, "boot_count"));
  const bootCount = Number.isSafeInteger(oldBootCount) && oldBootCount >= 0 ? oldBootCount + 1 : 1;
  await setValue(database, "boot_count", String(bootCount));
  const oldRevision = Number(await getValue(database, "data_revision"));
  const dataRevision = Number.isSafeInteger(oldRevision) && oldRevision >= 0 ? oldRevision : 0;
  return { database, bootCount, savedRoute, dataRevision };
}

export async function saveSafeRoute(database: SQLite.SQLiteDatabase, route: SafeRoute): Promise<void> {
  await setValue(database, "safe_route", JSON.stringify(route));
}

export async function bumpDataRevision(database: SQLite.SQLiteDatabase): Promise<number> {
  let next = 0;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ value: string }>(
      "SELECT value FROM spike_state WHERE key = ?", "data_revision",
    );
    const previous = Number(row?.value);
    next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    await transaction.runAsync(
      "INSERT INTO spike_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      "data_revision", String(next),
    );
  });
  return next;
}

export async function saveStaleClientFixture(database: SQLite.SQLiteDatabase): Promise<void> {
  await setValue(database, "safe_route", JSON.stringify({
    kind: "client", clientId: "deleted-client", section: "Training", unsavedDraft: "must not resume",
  }));
}

async function getValue(database: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM spike_state WHERE key = ?", key,
  );
  return row?.value ?? null;
}

async function setValue(database: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
  await database.runAsync(
    "INSERT INTO spike_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key, value,
  );
}

export { DEFAULT_ROUTE };

function parseRoute(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
