import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, type MigrationStep } from "../../apps/mobile/src/shared/db/MigrationRunner.ts";
import { WriterCoordinator } from "../../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { DEV_SCHEMA_OWNERS } from "../../apps/mobile/src/app/composition/devSchema.ts";
import { devClientCatalog } from "./history/DevClientCatalog.ts";
import { devCalendarCatalog } from "./history/DevCalendarCatalog.ts";
import { devAccountingCatalog } from "./history/DevAccountingCatalog.ts";
import { devMeasurementCatalog } from "./history/DevMeasurementCatalog.ts";
import { devNutritionCatalog } from "./history/DevNutritionCatalog.ts";
import { devQuestionnaireCatalog } from "./history/DevQuestionnaireCatalog.ts";
import { devTrainingPlansCatalog } from "./history/DevTrainingPlansCatalog.ts";
import { devTrainingExecutionCatalog } from "./history/DevTrainingExecutionCatalog.ts";
import { devExerciseCatalog } from "./history/DevExerciseCatalogRepository.ts";
import { devSettingsCatalog } from "./history/DevSettingsCatalog.ts";
import { devNotificationCatalog } from "./history/DevNotificationCatalog.ts";
import { nodeSqlitePort } from "../support/node-sqlite-port.ts";

/**
 * D01: владельцы схемы в порядке зависимостей (родитель раньше потомка), журнал миграций каждого и dev-цепочка, из которой собирается итоговая схема.
 * `file` — куда пишется базовая миграция владельца (относительно `apps/mobile/src`).
 */
export interface SchemaOwner {
  readonly owner: string;
  readonly ledger: string;
  readonly chain: readonly MigrationStep[];
  readonly file: string;
  readonly exportName: string;
}

const FILES: Readonly<Record<string, Readonly<{ file: string; exportName: string }>>> = {
  clients: { file: "features/clients/data/ClientsBaseline.generated.ts", exportName: "clientsBaseline" },
  calendar: { file: "features/calendar/data/CalendarBaseline.generated.ts", exportName: "calendarBaseline" },
  accounting: { file: "features/accounting/data/AccountingBaseline.generated.ts", exportName: "accountingBaseline" },
  measurements: { file: "features/measurements/data/MeasurementsBaseline.generated.ts", exportName: "measurementsBaseline" },
  nutrition: { file: "features/nutrition/data/NutritionBaseline.generated.ts", exportName: "nutritionBaseline" },
  questionnaire: { file: "features/questionnaire/data/QuestionnaireBaseline.generated.ts", exportName: "questionnaireBaseline" },
  training_plans: { file: "features/training/plans/data/TrainingPlansBaseline.generated.ts", exportName: "trainingPlansBaseline" },
  training_execution: { file: "features/training/execution/data/TrainingExecutionBaseline.generated.ts", exportName: "trainingExecutionBaseline" },
  exercises: { file: "features/exercises/data/ExercisesBaseline.generated.ts", exportName: "exercisesBaseline" },
  settings: { file: "features/settings/data/SettingsBaseline.generated.ts", exportName: "settingsBaseline" },
  notifications: { file: "features/notifications/data/NotificationsBaseline.generated.ts", exportName: "notificationsBaseline" },
};

const HISTORY: Readonly<Record<string, readonly MigrationStep[]>> = {
  clients: devClientCatalog,
  calendar: devCalendarCatalog,
  accounting: devAccountingCatalog,
  measurements: devMeasurementCatalog,
  nutrition: devNutritionCatalog,
  questionnaire: devQuestionnaireCatalog,
  training_plans: devTrainingPlansCatalog,
  training_execution: devTrainingExecutionCatalog,
  exercises: devExerciseCatalog,
  settings: devSettingsCatalog,
  notifications: devNotificationCatalog,
};

/** Runtime owner registry plus the archived chains used to verify baseline equivalence. */
export const SCHEMA_OWNERS: readonly SchemaOwner[] = DEV_SCHEMA_OWNERS.filter((owner) => HISTORY[owner.owner] !== undefined && FILES[owner.owner] !== undefined).map((owner) => ({ ...owner, chain: HISTORY[owner.owner]!, ...FILES[owner.owner]! }));

export interface SchemaObject {
  readonly type: "table" | "index" | "trigger";
  readonly name: string;
  readonly table: string;
  readonly sql: string;
}

/** Убирает префикс окружения `dev_` у идентификаторов (границы слова — не трогает ни строки ошибок, ни имена вида `xdev_`). */
export const stripDevPrefix = (sql: string): string => sql.replace(/\bdev_(?=[a-z0-9_])/gu, "");

const normalize = (sql: string): string => sql.replace(/\s+/gu, " ").trim();

/** Схема, как её видит SQLite: объекты в порядке создания, без служебных таблиц и журналов миграций. */
export function readSchema(db: DatabaseSync): readonly SchemaObject[] {
  const rows = db.prepare(`SELECT type, name, tbl_name AS "table", sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '%schema_migrations' AND sql IS NOT NULL ORDER BY rowid`).all() as unknown as readonly SchemaObject[];
  return rows;
}

/** Применяет цепочки миграций всех владельцев в порядке зависимостей к пустой базе. */
export async function applyOwners(db: DatabaseSync, steps: (owner: SchemaOwner) => readonly MigrationStep[]): Promise<void> {
  const writer = new WriterCoordinator(nodeSqlitePort(db));
  for (const owner of SCHEMA_OWNERS) await runMigrations(writer, steps(owner), owner.ledger);
}

/** Итоговая схема, собранная всей dev-цепочкой (имена как в dev). */
export async function buildChainSchema(): Promise<Readonly<{ db: DatabaseSync; byOwner: ReadonlyMap<string, readonly SchemaObject[]> }>> {
  const db = new DatabaseSync(":memory:");
  const byOwner = new Map<string, readonly SchemaObject[]>();
  const seen = new Set<string>();
  const writer = new WriterCoordinator(nodeSqlitePort(db));
  for (const owner of SCHEMA_OWNERS) {
    await runMigrations(writer, owner.chain, owner.ledger);
    const fresh = readSchema(db).filter((item) => !seen.has(`${item.type}:${item.name}`));
    fresh.forEach((item) => seen.add(`${item.type}:${item.name}`));
    byOwner.set(owner.owner, fresh);
  }
  return { db, byOwner };
}

/**
 * Базовая миграция владельца из итоговой схемы: таблицы → индексы → триггеры, в порядке создания, без префикса `dev_`.
 * Начальных строк dev-цепочки нет (проверено), поэтому baseline — только DDL.
 */
export function baselineSteps(objects: readonly SchemaObject[], owner: string): readonly MigrationStep[] {
  const order: Record<SchemaObject["type"], number> = { table: 0, index: 1, trigger: 2 };
  const statements = [...objects].sort((a, b) => order[a.type] - order[b.type]).map((item) => stripDevPrefix(item.sql));
  if (statements.length === 0) throw new Error(`BASELINE_EMPTY:${owner}`);
  const digest = createHash("sha256").update(statements.join("\n;\n")).digest("hex").slice(0, 16);
  return [{ version: 1, checksum: `d01-baseline-${owner}-${digest}`, statements }];
}

/** Нормализованное представление схемы для сравнения: имя, таблица и текст без префикса и лишних пробелов. */
export function comparable(objects: readonly SchemaObject[]): readonly string[] {
  return objects.map((item) => `${item.type}|${stripDevPrefix(item.name)}|${stripDevPrefix(item.table)}|${normalize(stripDevPrefix(item.sql))}`).sort();
}

export function renderBaselineFile(owner: SchemaOwner, steps: readonly MigrationStep[]): string {
  const step = steps[0]!;
  const lines = step.statements.map((statement) => `    ${JSON.stringify(statement)},`).join("\n");
  const up = "../".repeat(owner.file.split("/").length - 1);
  return `import type { MigrationStep } from "${up}shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца \`${owner.owner}\` — итоговая схема dev-цепочки без префикса \`dev_\`.
 * Файл создаётся \`npm run d01:baseline\` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале \`${owner.ledger}\`.
 */
export const ${owner.exportName}: readonly MigrationStep[] = [{
  version: 1,
  checksum: ${JSON.stringify(step.checksum)},
  statements: [
${lines}
  ],
}];
`;
}
