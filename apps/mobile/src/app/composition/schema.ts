import { runMigrations, type MigrationStep } from "../../shared/db/MigrationRunner.ts";
import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { DEV_ACCOUNTING_LEDGER, devAccountingCatalog } from "../../features/accounting/data/DevAccountingCatalog.ts";
import { DEV_CALENDAR_LEDGER, devCalendarCatalog } from "../../features/calendar/data/DevCalendarCatalog.ts";
import { DEV_CLIENTS_LEDGER, devClientCatalog } from "../../features/clients/data/DevClientCatalog.ts";
import { DEV_EXERCISES_LEDGER, devExerciseCatalog } from "../../features/exercises/data/DevExerciseCatalogRepository.ts";
import { DEV_MEASUREMENT_LEDGER, devMeasurementCatalog } from "../../features/measurements/data/DevMeasurementCatalog.ts";
import { DEV_NOTIFICATION_LEDGER, devNotificationCatalog } from "../../features/notifications/data/DevNotificationCatalog.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "../../features/nutrition/data/DevNutritionCatalog.ts";
import { DEV_QUESTIONNAIRE_LEDGER, devQuestionnaireCatalog } from "../../features/questionnaire/data/DevQuestionnaireCatalog.ts";
import { DEV_SETTINGS_LEDGER, devSettingsCatalog } from "../../features/settings/data/DevSettingsCatalog.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from "../../features/training/execution/data/DevTrainingExecutionCatalog.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from "../../features/training/plans/data/DevTrainingPlansCatalog.ts";
import { TRANSFER_OWNER } from "../../features/import/data/TransferReceiptStore.ts";

/** Владельцы схемы в порядке зависимостей: журнал каждого и runtime-каталог, начиная с baseline v1. */
export const SCHEMA_OWNERS: readonly Readonly<{ owner: string; ledger: string; chain: readonly MigrationStep[] }>[] = [
  { owner: "clients", ledger: DEV_CLIENTS_LEDGER, chain: devClientCatalog },
  { owner: "calendar", ledger: DEV_CALENDAR_LEDGER, chain: devCalendarCatalog },
  { owner: "accounting", ledger: DEV_ACCOUNTING_LEDGER, chain: devAccountingCatalog },
  { owner: "measurements", ledger: DEV_MEASUREMENT_LEDGER, chain: devMeasurementCatalog },
  { owner: "nutrition", ledger: DEV_NUTRITION_LEDGER, chain: devNutritionCatalog },
  { owner: "questionnaire", ledger: DEV_QUESTIONNAIRE_LEDGER, chain: devQuestionnaireCatalog },
  { owner: "training_plans", ledger: DEV_TRAINING_PLANS_LEDGER, chain: devTrainingPlansCatalog },
  { owner: "training_execution", ledger: DEV_TRAINING_EXECUTION_LEDGER, chain: devTrainingExecutionCatalog },
  { owner: "exercises", ledger: DEV_EXERCISES_LEDGER, chain: devExerciseCatalog },
  { owner: "settings", ledger: DEV_SETTINGS_LEDGER, chain: devSettingsCatalog },
  { owner: "notifications", ledger: DEV_NOTIFICATION_LEDGER, chain: devNotificationCatalog },
  TRANSFER_OWNER,
];

/**
 * Создаёт схему всех владельцев до первой инициализации репозиториев. Миграции начальных строк не вставляют (проверено), а засев
 * (рабочее пространство, типы занятий, каталог упражнений) делают сами репозитории, поэтому сразу после этого база пуста и в неё
 * можно переносить данные прежней dev-базы без конфликтов.
 */
export async function prepareSchema(database: SharedSqliteDatabase): Promise<void> {
  const lease = await database.acquire();
  try {
    for (const owner of SCHEMA_OWNERS) await runMigrations(lease.writer, owner.chain, owner.ledger);
  } finally {
    await database.release();
  }
}
