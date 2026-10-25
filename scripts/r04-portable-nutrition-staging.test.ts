import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyNutritionStagingExtension } from "../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStaging.ts";
import { legacyLoadNutritionPlan, legacyLoadNutritionArchivesPlan, nutritionTargetTables } from "../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStagePlan.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { isLegacyLocalDate } from "../apps/mobile/src/shared/migration/LegacyValues.ts";
import { runLegacyWritePlan, type LegacyNutritionCheckpoint } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { scope, importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";

import { referenceDay, beforeNutrition, extension, records, empty, fixture } from "./support/legacy-nutrition-staging.ts";

const phases: readonly LegacyNutritionCheckpoint[] = ["after-nutrition-ids", "after-nutrition-rows", "after-nutrition-receipt"];

test("admitted complete source reaches async nutrition staging with host-identical snapshots, facts, recipes, archives and IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  const actual = result.extensionResult![1]; assert.deepEqual([actual.nutritionFoodRows, actual.nutritionRecipeRows, actual.nutritionEntryRows, actual.nutritionWaterRows, actual.nutritionStepRows, actual.nutritionWorkoutMarkRows, actual.nutritionCalcProfileRows, actual.nutritionArchiveWeekRows], [1, 1, 4, 2, 5, 1, 2, 3]);
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), refs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true, plans: true, templates: true, archives: true, executions: true, measurements: { referenceDay }, nutrition: true } });
    ledger.stageClientNutrition(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, refs, f.snapshots.plans, f.snapshots.executions, f.snapshots.measurements, f.snapshots.nutrition, allocator());
  })); assert.deepEqual(records(f.stagePath), records(hostPath));
  const client = result.ids.clients.get(JSON.stringify([scope, "a"]))!, db = await openIsolatedSqliteConnection(f.native.open);
  try {
    const rows = await runLegacyWritePlan(db, legacyLoadNutritionPlan()); assert.equal(rows.length, 4);
    const historical = rows.find((row) => row.client_id === client && row.quantity_x10 === 174)!;
    assert.deepEqual([historical.per_kcal_x10, historical.override_kcal_x10, historical.override_base_quantity_x10], [1000, 170, 174]);
    assert.equal((await db.first<{ kcal_x10: number }>("SELECT kcal_x10 FROM food_products"))!.kcal_x10, 3000);
    assert.ok(rows.every((row) => row.source_kind === "FOOD" && row.ingredients_json === "[]"));
    const archives = await runLegacyWritePlan(db, legacyLoadNutritionArchivesPlan(f.context.targetWorkspaceId, client)); assert.equal(archives.length, 2);
    assert.ok(archives.some((week) => week.aggregates.avg_weight.state === "VALUE" && week.aggregates.avg_weight.sourceDecimal === "80.125"));
    assert.ok(archives.every((week) => week.semantics === "HISTORICAL_SNAPSHOT_NOT_DAILY_FACTS"));
    await assert.rejects(runLegacyWritePlan(db, legacyLoadNutritionArchivesPlan(f.context.targetWorkspaceId, "absent")), /OWNER_INVALID/u);
    assert.equal((await db.first<{ n: number }>("SELECT count(*) AS n FROM r04_execution_facts"))!.n, 6);
  } finally { await db.close(); }
  inspect(f.stagePath, (db) => { const receipt = db.prepare("SELECT * FROM r04_nutrition_receipt").get()!; assert.equal(receipt.target_sha256, createHash("sha256").update(receipt.target_json as string).digest("hex")); assert.ok((receipt.source_json as string).includes("source extras preserved")); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0); assert.equal(result.finalizable, false);
}));

test("every nutrition table checkpoint and final boundary rolls back the whole chain then retry/replay retain IDs", async () => {
  const failures = [{ phase: phases[0]!, occurrence: 1 }, ...nutritionTargetTables.map((_, i) => ({ phase: "after-nutrition-rows" as const, occurrence: i + 1 })), { phase: phases[2]!, occurrence: 1 }, { phase: "before-commit" as const, occurrence: 1 }];
  for (const { phase, occurrence } of failures) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let seen = 0;
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator(), async (at) => { if (at === phase && ++seen === occurrence) { await Promise.resolve(); throw new Error("PRIVATE nutrition interruption"); } }), /WRITE_FAILED/u); assert.equal(seen, occurrence); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocator()); const before = records(f.stagePath), source = structuredClone(f.snapshots);
    for (const rows of Object.values(source.nutrition.tables)) if (rows) (rows as unknown[]).reverse();
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(source)); await reopened.stageClients(source.clients, () => assert.fail("replay allocated")); assert.deepEqual(records(f.stagePath), before);
    assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("nutrition commit or close acknowledgement failure cannot duplicate diary entries or archive IDs", async () => {
  for (const kind of ["commit", "close"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
    f.native.state.after = (call) => { if (!failed && (kind === "commit" ? call.kind === "exec" && call.sql === "COMMIT" : call.kind === "close")) { failed = true; throw new Error("PRIVATE acknowledgement lost"); } };
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); const before = records(f.stagePath); f.native.state.after = undefined;
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("nutrition source capture resists changes before await and inside preceding-owner callbacks", () => fixture(async (f) => {
  const input = structuredClone(f.snapshots), owner = extension(input); Object.assign(input.nutrition.tables.food_products![0]!, { name: "Changed product" });
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner);
  await stage.stageClients(f.snapshots.clients, allocator(), (at) => { if (at === "after-measurement-receipt") Object.assign(input.nutrition.tables.nutrition_archive_weeks![0]!, { days_json: "changed private source" }); });
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM food_products WHERE name='Changed product'").get()!.n, 0); assert.equal((db.prepare("SELECT source_json FROM r04_nutrition_receipt").get()!.source_json as string).includes("changed private source"), false); });
}));

test("nutrition daily-source mismatch, foreign owner, duplicate entry and pending cross-owner identity collision are atomic", async () => {
  for (const kind of ["daily", "owner", "duplicate", "collision"] as const) await fixture(async (f) => {
    const input = structuredClone(f.snapshots);
    if (kind === "daily") Object.assign(input.nutrition.tables.client_day_facts![0]!, { weight: "99" });
    if (kind === "owner") Object.assign(input.nutrition.tables.nutrition_days![0]!, { client_id: "absent" });
    if (kind === "duplicate") (input.nutrition.tables.nutrition_days as unknown[]).push(input.nutrition.tables.nutrition_days![0]);
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(input)); const next = allocator(); let active = false, collided = false;
    await assert.rejects(stage.stageClients(input.clients, () => { if (active && !collided) { collided = true; return "11111111-1111-4111-8111-000000000001"; } return next(); },
      (at) => { if (kind === "collision" && at === "after-measurement-receipt") active = true; }), /R04_ID_LEDGER_NUTRITION_/u); empty(f.stagePath);
  });
});

test("nutrition guarded reads and replay reject all fact, archive, identity and receipt drift", async () => {
  for (const sql of ["UPDATE food_diary_entries SET quantity_x10=quantity_x10+1", "UPDATE food_products SET name='Changed'", "UPDATE recipes SET name='Changed'", "UPDATE recipe_ingredients SET quantity_x10=quantity_x10+1",
    "UPDATE water_days SET ml=ml+1", "UPDATE nutrition_calc_profiles SET workout_minutes=workout_minutes+1", "UPDATE r04_nutrition_archive_weeks SET payload_json='{}'",
    "UPDATE r04_nutrition_ids SET source_key=source_key||' '", "UPDATE r04_nutrition_receipt SET source_json='{}'", "UPDATE r04_nutrition_receipt SET target_json='{}'", "UPDATE r04_nutrition_receipt SET target_sha256=printf('%064d',0)"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator()); inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    const db = await openIsolatedSqliteConnection(f.native.open); try { await assert.rejects(runLegacyWritePlan(db, legacyLoadNutritionPlan()), /NUTRITION_PARITY_MISMATCH/u); } finally { await db.close(); }
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /NUTRITION_(?:PARITY_MISMATCH|IDENTITY_INVALID)/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("nutrition mode cannot bypass measurements or claim an existing earlier-owner database before WAL", () => fixture(async (f) => {
  assert.throws(() => combineLegacyStageExtensions(legacyNutritionStagingExtension(f.snapshots.nutrition)), /EXTENSION_ORDER_INVALID/u);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, beforeNutrition(f.snapshots)); const before = digest(f.stagePath), count = f.native.calls.length;
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /FOREIGN_DATABASE/u); assert.equal(digest(f.stagePath), before);
  assert.equal(f.native.calls.slice(count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)), false);
  assert.ok(f.native.calls.slice(0, count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)));
}));

test("nutrition schema and native row failures rollback every preceding owner and close all handles", async () => {
  for (const kind of ["schema", "write"] as const) await fixture(async (f) => {
    if (kind === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (kind === "schema" ? call.sql.startsWith("CREATE TABLE r04_nutrition_ids(") : call.sql.startsWith("INSERT INTO food_diary_entries("))) { failed = true; return true; } return false; };
    if (kind === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator());
  });
});

test("nutrition archive decimal tokens remain exact while unrepresentable live totals become review", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator()); assert.equal(result.extensionResult![1].nutritionEntryRows, 3);
  inspect(f.stagePath, (db) => { const receipt = db.prepare("SELECT * FROM r04_nutrition_receipt").get()!; assert.ok((receipt.source_json as string).includes("17.000000000000001")); assert.ok((receipt.target_json as string).includes("PRECISION_UNREPRESENTABLE")); assert.ok((db.prepare("SELECT payload_json FROM r04_nutrition_archive_weeks WHERE source_key LIKE '%archive-a%'").get()!.payload_json as string).includes("81.2500000000000001")); });
}, (db) => {
  const row = db.prepare("SELECT meals_json FROM nutrition_days WHERE client_id='a' AND date_key='2026-03-01'").get()!;
  db.prepare("UPDATE nutrition_days SET meals_json=? WHERE client_id='a' AND date_key='2026-03-01'").run((row.meals_json as string).replace('"calories":17', '"calories":17.000000000000001'));
  const archive = db.prepare("SELECT days_json FROM nutrition_archive_weeks WHERE id='archive-a'").get()!;
  db.prepare("UPDATE nutrition_archive_weeks SET days_json=? WHERE id='archive-a'").run((archive.days_json as string).replace('"weight":81.25', '"weight":81.2500000000000001'));
}));

test("legacy saved-date validation retains the previous year and leap-day rules", () => {
  for (const [date, valid] of [["0000-01-01", false], ["0099-12-31", false], ["0100-01-01", true], ["2024-02-29", true], ["2026-02-30", false], ["9999-12-31", true]] as const) assert.equal(isLegacyLocalDate(date), valid, date);
});
