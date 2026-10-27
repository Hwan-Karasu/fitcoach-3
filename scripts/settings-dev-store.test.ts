import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevSettingsRepository } from "../apps/mobile/src/features/settings/data/DevSettingsRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { appThemes } from "../apps/mobile/src/shared/ui/theme/themes.ts";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { parseAppearance } from "../apps/mobile/src/features/settings/domain/SettingsPort.ts";
import { CLIENT_START_SECTIONS, DEFAULT_CLIENT_CARDS, normalizeClientCards } from "../apps/mobile/src/shared/domain/ClientCardPreference.ts";

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

test("client card section, ordered metric choices and badge survive restart without losing other appearance settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-client-cards-"));
  const file = join(dir, "settings.db");
  try {
    for (const section of CLIENT_START_SECTIONS) {
      const first = open(new DatabaseSync(file));
      await first.initialize();
      const clientCards = normalizeClientCards({ startSection: section.id, metricIds: ["weight", "steps", "credits", "fatPercent"], showHealthBadge: false });
      const appearance = { themeId: "warm-sand", accentId: "caramel", clientCards, hideNavigationLabels: true, dutyColor: "#B64D00", hiddenSessionTypeIds: ["removed-type"] };
      await first.saveAppearance(appearance);
      await first.close();
      const second = open(new DatabaseSync(file));
      await second.initialize();
      assert.deepEqual(await second.readAppearance(), appearance);
      await second.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("client card preference validates section and metric IDs, caps four, and allows intentionally empty tiles", () => {
  assert.deepEqual(normalizeClientCards(null), DEFAULT_CLIENT_CARDS);
  assert.deepEqual(normalizeClientCards({ startSection: "unknown", metricIds: ["steps", "steps", "bad", "credits", "weight", "calories", "fatPercent"], showHealthBadge: "false" }),
    { startSection: "Home", metricIds: ["steps", "credits", "weight", "calories"], showHealthBadge: true });
  assert.deepEqual(normalizeClientCards({ metricIds: [] }).metricIds, []);
  assert.equal(normalizeClientCards({ startSection: "Profile" }).startSection, "More");
  assert.equal(normalizeClientCards({ startSection: "Archive" }).startSection, "More");
  assert.deepEqual(CLIENT_START_SECTIONS.map((section) => section.id), ["Home", "Nutrition", "Training", "More"]);
});

test("Z01 navigation settings survive restart with theme/accent and rapid writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-navigation-prefs-"));
  const file = join(dir, "settings.db");
  try {
    for (const showClientListShortcut of [false, true]) for (const hideNavigationLabels of [false, true]) for (const dutyColor of [null, "#2456A6"]) {
      const first = open(new DatabaseSync(file));
      await first.initialize();
      const choice = { themeId: "night-mocha", accentId: "latte", showClientListShortcut, hideNavigationLabels, dutyColor,
        hiddenSessionTypeIds: ["used-type-id", "pack-type-id"] };
      await Promise.all([
        first.saveAppearance({ ...choice, hideNavigationLabels: !hideNavigationLabels }),
        first.saveAppearance({ ...choice, themeId: "warm-sand", accentId: "caramel" }),
        first.saveAppearance(choice),
      ]);
      await first.close();
      const second = open(new DatabaseSync(file));
      await second.initialize();
      assert.deepEqual(await second.readAppearance(), choice);
      await second.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("пресеты дежурства переживают перезапуск вместе с оформлением, битые отбрасываются при чтении", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-duty-presets-"));
  const file = join(dir, "settings.db");
  try {
    const first = open(new DatabaseSync(file));
    await first.initialize();
    const dutyPresets = [{ id: "morning", name: "Утро", startMinute: 480, endMinute: 720 }];
    await first.saveAppearance({ themeId: "warm-sand", accentId: "caramel", dutyPresets });
    await first.close();
    const second = open(new DatabaseSync(file));
    await second.initialize();
    assert.deepEqual((await second.readAppearance())?.dutyPresets, dutyPresets);
    await second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const old = { themeId: "warm-sand", accentId: "caramel" };
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, dutyPresets: [{ id: "x", name: "", startMinute: 0, endMinute: 60 }] })),
    { ...old, dutyPresets: [] });
});

test("Z01 old appearance and corrupt navigation fields retain the usable theme", () => {
  const old = { themeId: "warm-sand", accentId: "caramel" };
  assert.deepEqual(parseAppearance(JSON.stringify(old)), old);
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, dutyColor: "invalid" })), old);
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, dutyColor: 7 })), old);
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, hiddenSessionTypeIds: [7] })), old);
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, hiddenSessionTypeIds: ["type", "type"] })),
    { ...old, hiddenSessionTypeIds: ["type"] });
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, hideNavigationLabels: "false", showClientListShortcut: 1 })), old);
  assert.deepEqual(parseAppearance(JSON.stringify({ ...old, hideNavigationLabels: false, showClientListShortcut: true })),
    { ...old, hideNavigationLabels: false, showClientListShortcut: true });
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

test("Z01 all 18 choices survive restart and queued rapid changes keep the final choice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-theme-matrix-"));
  const file = join(dir, "settings.db");
  try {
    for (const theme of appThemes) for (const accent of theme.accentSwatches) {
      const first = open(new DatabaseSync(file));
      await first.initialize();
      await first.saveAppearance({ themeId: theme.id, accentId: accent.id });
      await first.close();
      const second = open(new DatabaseSync(file));
      await second.initialize();
      const restored = await second.readAppearance();
      assert.deepEqual(restored, { themeId: theme.id, accentId: accent.id });
      assert.equal(resolvePalette(restored!, "warm-sand").accentId, accent.id);
      await second.close();
    }
    const rapid = open(new DatabaseSync(file));
    await rapid.initialize();
    const choices = appThemes.flatMap((theme) => theme.accentSwatches.map((accent) => ({ themeId: theme.id, accentId: accent.id })));
    await Promise.all(choices.map((choice) => rapid.saveAppearance(choice)));
    await rapid.close();
    const final = open(new DatabaseSync(file));
    await final.initialize();
    assert.deepEqual(await final.readAppearance(), choices.at(-1));
    await final.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
