import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevExerciseCatalogRepository } from "../apps/mobile/src/features/exercises/data/DevExerciseCatalogRepository.ts";
import type { ExerciseDefinition, SystemCatalog } from "../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import { EMPTY_OVERLAY, filterCatalog, matchesQuery, NO_FILTERS, normalizeAliases, sortCatalog, validateCustom } from
  "../apps/mobile/src/features/exercises/domain/ExerciseRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";

function system(id: string, name: string, nameEn: string, extra: Partial<ExerciseDefinition> = {}): ExerciseDefinition {
  return { id, origin: "SYSTEM", name, nameEn, bodyPart: "chest", primaryMuscles: [], secondaryMuscles: [],
    equipment: "barbell", trackingProfile: "LOAD_REPS", mechanic: "compound", difficulty: null, unilateral: false,
    variationGroup: null, instructions: [], tips: [], textLanguage: "ru", media: null, source: { provider: "REPDB", sourceId: id.slice(10) },
    ...extra };
}

const CATALOG: SystemCatalog = {
  meta: { provider: "REPDB", datasetName: "synthetic", datasetSchemaVersion: 3, sourceSha256: "0", importedAt: "2026-10-17",
    license: "synthetic", attribution: "Exercise data by RepDB (repdb.co)", count: 2, missingRuNames: 0 },
  exercises: [
    system("sys:repdb:synthetic-press", "Жим штанги лёжа", "Barbell Bench Press"),
    system("sys:repdb:synthetic-plank", "Планка", "Plank", { bodyPart: "core", equipment: null, trackingProfile: "DURATION" }),
  ],
};

async function store() {
  const db = new DatabaseSync(":memory:");
  const repository = new DevExerciseCatalogRepository(new SharedSqliteDatabase(async () => nodeSqlitePort(db)), WS, CATALOG);
  await repository.initialize();
  return { db, repository };
}

const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

test("X01 поиск: русское и английское название, «ё», синонимы; фильтры и режимы", async () => {
  const { repository } = await store();
  try {
    const entries = await repository.list();
    const press = entries.find((entry) => entry.definition.id === "sys:repdb:synthetic-press")!;
    assert.equal(matchesQuery(press, "жим лежа"), true, "«ё» не важна");
    assert.equal(matchesQuery(press, "bench"), true);
    assert.equal(matchesQuery(press, "присед"), false);
    await repository.setPersonal(press.definition.id, { displayName: null, aliases: ["  жимовой ", "Жимовой", ""] });
    const withAlias = (await repository.get(press.definition.id))!;
    assert.deepEqual(withAlias.overlay.aliases, ["жимовой"], "синонимы без повторов и пустых");
    assert.equal(matchesQuery(withAlias, "жимовой"), true);
    assert.deepEqual(filterCatalog(entries, "", "ALL", { ...NO_FILTERS, bodyParts: new Set(["core"]) })
      .map((entry) => entry.definition.name), ["Планка"]);
    assert.deepEqual(filterCatalog(entries, "", "ALL", { ...NO_FILTERS, equipment: new Set(["none"]) })
      .map((entry) => entry.definition.name), ["Планка"], "без оборудования — отдельное значение фильтра");
  } finally {
    await repository.close();
  }
});

test("X01 сортировка: по-русски, кавычки не влияют, «ё» на своём месте", async () => {
  const { repository } = await store();
  try {
    const names = ["«Мёртвый жук»", "Ёлочка", "Жим", "Армейский жим"];
    const entries = names.map((name, index) => ({ definition: system(`sys:repdb:s${index}`, name, name), overlay: EMPTY_OVERLAY }));
    assert.deepEqual(sortCatalog(entries).map((entry) => entry.definition.name), ["Армейский жим", "Ёлочка", "Жим", "«Мёртвый жук»"]);
    assert.equal(sortCatalog(await repository.list()).length, 2);
  } finally {
    await repository.close();
  }
});

test("X01 своё упражнение: категория обязательна, правка по ревизии, системное только для чтения", async () => {
  const { repository } = await store();
  try {
    assert.throws(() => validateCustom({ name: "Жим", bodyPart: null, equipment: null, trackingProfile: "LOAD_REPS" }),
      message("EXERCISE_CATEGORY_REQUIRED"));
    await assert.rejects(repository.createCustom({ name: " ", bodyPart: "chest", equipment: null, trackingProfile: "REPS" }),
      message("EXERCISE_NAME_INVALID"));
    const mine = await repository.createCustom({ name: "  Жим  в тренажёре Хаммер ", bodyPart: "chest",
      equipment: "chest_press_machine", trackingProfile: "LOAD_REPS" });
    assert.match(mine.id, /^usr:/);
    assert.equal(mine.name, "Жим в тренажёре Хаммер");
    assert.equal(mine.origin, "CUSTOM");
    const all = await repository.list();
    assert.deepEqual(filterCatalog(all, "", "MINE", NO_FILTERS).map((entry) => entry.definition.id), [mine.id]);
    const revision = (await repository.revisionOf(mine.id))!;
    await repository.updateCustom(mine.id, revision, { name: "Хаммер", bodyPart: "chest", equipment: null, trackingProfile: "LOAD_REPS" });
    await assert.rejects(repository.updateCustom(mine.id, revision, { name: "Старое", bodyPart: "chest", equipment: null,
      trackingProfile: "LOAD_REPS" }), message("EXERCISE_STALE"));
    await assert.rejects(repository.updateCustom("sys:repdb:synthetic-press", 1, { name: "x", bodyPart: "chest",
      equipment: null, trackingProfile: "LOAD_REPS" }), message("EXERCISE_SYSTEM_READ_ONLY"));
    await repository.archiveCustom(mine.id);
    assert.equal(await repository.get(mine.id), null, "архивное своё упражнение не в каталоге");
  } finally {
    await repository.close();
  }
});

test("X01 личный слой: избранное и скрытое у системных; неизвестный ID отклоняется; схема держит ограничения", async () => {
  const { db, repository } = await store();
  try {
    await repository.setFavorite("sys:repdb:synthetic-plank", true);
    await repository.setHidden("sys:repdb:synthetic-press", true);
    const entries = await repository.list();
    assert.deepEqual(filterCatalog(entries, "", "FAVORITES", NO_FILTERS).map((entry) => entry.definition.name), ["Планка"]);
    assert.deepEqual(filterCatalog(entries, "", "ALL", NO_FILTERS).map((entry) => entry.definition.name), ["Планка"],
      "скрытое не показывается без фильтра «Скрытые»");
    assert.equal(filterCatalog(entries, "", "ALL", { ...NO_FILTERS, showHidden: true }).length, 2);
    await assert.rejects(repository.setFavorite("sys:repdb:missing", true), message("EXERCISE_NOT_FOUND"));
    assert.throws(() => db.prepare(`INSERT INTO dev_custom_exercises (id, workspace_id, name, body_part, tracking_profile,
      revision, created_at, updated_at) VALUES ('usr:x', ?, 'Без группы', 'tail', 'REPS', 1, 'now', 'now')`).run(WS), /CHECK/);
    assert.deepEqual(normalizeAliases(["a", "A ", "б"]), ["a", "б"]);
  } finally {
    await repository.close();
  }
});
