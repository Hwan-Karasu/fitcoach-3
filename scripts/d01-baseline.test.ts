import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { accountingBaseline } from "../apps/mobile/src/features/accounting/data/AccountingBaseline.generated.ts";
import { calendarBaseline } from "../apps/mobile/src/features/calendar/data/CalendarBaseline.generated.ts";
import { clientsBaseline } from "../apps/mobile/src/features/clients/data/ClientsBaseline.generated.ts";
import { exercisesBaseline } from "../apps/mobile/src/features/exercises/data/ExercisesBaseline.generated.ts";
import { measurementsBaseline } from "../apps/mobile/src/features/measurements/data/MeasurementsBaseline.generated.ts";
import { notificationsBaseline } from "../apps/mobile/src/features/notifications/data/NotificationsBaseline.generated.ts";
import { nutritionBaseline } from "../apps/mobile/src/features/nutrition/data/NutritionBaseline.generated.ts";
import { questionnaireBaseline } from "../apps/mobile/src/features/questionnaire/data/QuestionnaireBaseline.generated.ts";
import { settingsBaseline } from "../apps/mobile/src/features/settings/data/SettingsBaseline.generated.ts";
import { trainingExecutionBaseline } from "../apps/mobile/src/features/training/execution/data/TrainingExecutionBaseline.generated.ts";
import { trainingPlansBaseline } from "../apps/mobile/src/features/training/plans/data/TrainingPlansBaseline.generated.ts";
import type { MigrationStep } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { applyOwners, baselineSteps, buildChainSchema, comparable, readSchema, renderBaselineFile, SCHEMA_OWNERS, stripDevPrefix } from "./d01/BaselineSchema.ts";

const baselines: Readonly<Record<string, readonly MigrationStep[]>> = {
  clients: clientsBaseline, calendar: calendarBaseline, accounting: accountingBaseline, measurements: measurementsBaseline, nutrition: nutritionBaseline,
  questionnaire: questionnaireBaseline, training_plans: trainingPlansBaseline, training_execution: trainingExecutionBaseline, exercises: exercisesBaseline,
  settings: settingsBaseline, notifications: notificationsBaseline,
};

test("D01 базовые миграции всех владельцев создают ту же схему, что и вся dev-цепочка (с точностью до префикса dev_)", async () => {
  const chain = await buildChainSchema();
  const fresh = new DatabaseSync(":memory:");
  await applyOwners(fresh, (owner) => baselines[owner.owner]!);
  assert.deepEqual(comparable(readSchema(fresh)), comparable(readSchema(chain.db)));
  assert.equal(fresh.prepare("PRAGMA foreign_key_check").all().length, 0);
  const count = (db: DatabaseSync, type: string) => (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'").get(type) as { n: number }).n;
  assert.deepEqual([count(fresh, "table"), count(fresh, "index"), count(fresh, "trigger")].map(Number), [64 + SCHEMA_OWNERS.length, 38, 31],
    "64 таблицы данных + журналы миграций владельцев, 38 индексов, 31 триггер");
});

test("D01 в базовых миграциях нет префикса окружения, версия одна, журнал у каждого владельца свой", () => {
  const ledgers = new Set<string>();
  for (const owner of SCHEMA_OWNERS) {
    const steps = baselines[owner.owner]!;
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.version, 1);
    assert.ok(steps[0]!.checksum.startsWith(`d01-baseline-${owner.owner}-`));
    assert.ok(steps[0]!.statements.every((statement) => !/\bdev_/u.test(statement)), `${owner.owner}: остался dev_`);
    ledgers.add(owner.ledger);
  }
  assert.equal(ledgers.size, SCHEMA_OWNERS.length);
  assert.ok(SCHEMA_OWNERS.every((owner) => /^[a-z][a-z0-9_]*_schema_migrations$/u.test(owner.ledger)));
});

test("D01 сгенерированные файлы не отстают от dev-цепочки: перегенерация даёт тот же текст", async () => {
  const chain = await buildChainSchema();
  for (const owner of SCHEMA_OWNERS) {
    const expected = renderBaselineFile(owner, baselineSteps(chain.byOwner.get(owner.owner) ?? [], owner.owner));
    const actual = readFileSync(resolve(import.meta.dirname, "../apps/mobile/src", owner.file), "utf8").replace(/\r\n/gu, "\n");
    assert.equal(actual, expected, `${owner.owner}: запустите node --experimental-strip-types scripts/d01/generate-baseline.ts`);
  }
});

test("D01 префикс убирается только у идентификаторов: границы слова и значения не затронуты", () => {
  assert.equal(stripDevPrefix("CREATE TABLE dev_clients (id TEXT REFERENCES dev_workspaces(id))"), "CREATE TABLE clients (id TEXT REFERENCES workspaces(id))");
  assert.equal(stripDevPrefix("xdev_name 'ACCOUNTING_LEDGER' dev_"), "xdev_name 'ACCOUNTING_LEDGER' dev_");
});
