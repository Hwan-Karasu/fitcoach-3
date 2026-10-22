import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevSettingsRepository } from "../apps/mobile/src/features/settings/data/DevSettingsRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";

function open(db: DatabaseSync, workspace = WS, shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db))) {
  return new DevSettingsRepository(shared, workspace);
}

test("Z01 пустое хранилище отдаёт null, а не выдуманное значение", async () => {
  const store = open(new DatabaseSync(":memory:"));
  await store.initialize();
  assert.equal(await store.readAppearance(), null);
  assert.equal(await store.readMeasurementGroups(), null);
  await store.close();
});

test("Z01 тема и акцент переживают закрытие и повторное открытие базы", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-settings-"));
  const file = join(dir, "settings.db");
  const first = open(new DatabaseSync(file));
  await first.initialize();
  await first.saveAppearance({ themeId: "noir", accentId: "amber" });
  await first.saveAppearance({ themeId: "noir", accentId: null });
  await first.close();
  const second = open(new DatabaseSync(file));
  await second.initialize();
  assert.deepEqual(await second.readAppearance(), { themeId: "noir", accentId: null });
  await second.close();
  rmSync(dir, { recursive: true, force: true });
});

test("Z01 видимые группы замеров сохраняются без дублей и не пересекаются с другим рабочим пространством", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const a = open(db, WS, shared);
  const b = open(db, "synthetic-workspace-b", shared);
  await a.initialize();
  await a.saveMeasurementGroups(["WAIST", "CHEST", "WAIST"]);
  assert.deepEqual(await a.readMeasurementGroups(), ["CHEST", "WAIST"]);
  await a.saveMeasurementGroups([]);
  assert.deepEqual(await a.readMeasurementGroups(), [], "пустой набор — осознанный выбор, не «нет значения»");
  await b.initialize();
  assert.equal(await b.readMeasurementGroups(), null);
  await a.close();
  await b.close();
});

test("Z01 подписчик получает уведомление после commit и отписывается", async () => {
  const store = open(new DatabaseSync(":memory:"));
  await store.initialize();
  let calls = 0;
  const off = store.subscribeCommittedChanges(() => { calls += 1; });
  await store.saveAppearance({ themeId: "zefirka", accentId: null });
  assert.equal(calls, 1);
  off();
  await store.saveAppearance({ themeId: "zefirka", accentId: null });
  assert.equal(calls, 1);
  await store.close();
});

test("Z01 повреждённое значение читается как «не сохранено»; схема отвергает чужой ключ и не-JSON", async () => {
  const db = new DatabaseSync(":memory:");
  const store = open(db);
  await store.initialize();
  db.prepare("INSERT INTO settings VALUES (?, 'appearance', '{\"themeId\":5}', 1, 'x')").run(WS);
  assert.equal(await store.readAppearance(), null);
  assert.throws(() => db.prepare("INSERT INTO settings VALUES (?, 'other', '1', 1, 'x')").run(WS));
  assert.throws(() => db.prepare("INSERT INTO settings VALUES (?, 'measurement.visibleGroups', 'не json', 1, 'x')").run(WS));
  await store.close();
});
