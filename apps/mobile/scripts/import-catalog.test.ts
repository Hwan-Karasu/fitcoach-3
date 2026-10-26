import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, createRef, useState } from "react";
import TestRenderer from "react-test-renderer";
import { equipmentChoices } from "../src/features/exercises/domain/EquipmentSearch.ts";
import { filterCatalog, filterOptionCounts, NO_FILTERS, EMPTY_OVERLAY, type CatalogEntry } from "../src/features/exercises/domain/ExerciseRules.ts";
import { KNOWN_EQUIPMENT } from "../src/features/exercises/domain/ExerciseLabels.ts";
import { useCatalogBack, type CatalogBackHandle } from "../src/features/exercises/presentation/useCatalogBack.ts";
import { previousImportPage, type ImportPage } from "../src/app/navigation/importBack.ts";
import { startWorkbookReview, selectWorkbookSheet, setWorkbookNameMatch, workbookSourceNames, workbookMatchesToRemember, requireWorkbookNameChoices,
  updateWorkbookEntry, autoMatchWorkbookEntry } from "../src/features/import/domain/WorkbookReviewSession.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../src/features/import/domain/LegacyExcel.ts";
import type { ImportTable, PickedWorkbook } from "../src/features/import/domain/WorkbookFilesPort.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const table = (name: string, names: readonly string[]): ImportTable => ({ name, rows: [["Упражнение", "План повторений"], ...names.map((n) => [n, "8-10"])] });
const book = (tables: readonly ImportTable[]): PickedWorkbook => ({ kind: "TABLES", sourceId: "i04-synthetic", tables });

test("I04 manual catalogue choice reaches all identical source names, including unopened sheets and future cycles", () => {
  let session = startWorkbookReview(book([table("Первый цикл", ["Тяга", "Жим"]), table("Второй цикл", ["Тяга", "Тяга"])]), true);
  const before = JSON.stringify(session.entries["0"]!.value!.programs);
  assert.deepEqual(workbookSourceNames(session), ["Тяга", "Жим"]);
  session = setWorkbookNameMatch(session, "Тяга", "custom:one-created-exercise");
  const id = session.entries["0"]!.value!.exercises.find((e) => e.name === "Тяга")!.id;
  assert.equal(session.entries["0"]!.mapping[id], "custom:one-created-exercise");
  assert.equal(JSON.stringify(session.entries["0"]!.value!.programs), before, "only matching changes; plan and fact identities are preserved");
  session = selectWorkbookSheet(session, "1");
  const other = session.entries["1"]!.value!.exercises.find((e) => e.name === "Тяга")!.id;
  assert.equal(session.entries["1"]!.mapping[other], "custom:one-created-exercise");
  assert.deepEqual(workbookMatchesToRemember(session), [{ sourceName: "Тяга", targetId: "custom:one-created-exercise" }]);
  session = setWorkbookNameMatch(session, "Тяга", "sys:another-choice");
  assert.equal(session.entries["0"]!.mapping[id], "sys:another-choice");
});

test("I04 literal names retain case, ё, punctuation and inner whitespace without changing old non-colliding IDs", () => {
  const names = ["Жим", "жим", "Жим лёжа", "Жим лежа", "Жим-лёжа", "Жим  лёжа", "Жим лёжа"];
  const input = table("Буква в букву", names); const detected = detectLegacyMapping(input);
  const value = normalizeLegacyTable(input, "file", detected.header, detected.mapping);
  assert.equal(value.exercises.length, 6);
  assert.equal(new Set(value.exercises.map((e) => e.id)).size, 6);
  let session = startWorkbookReview(book([input]), true);
  session = setWorkbookNameMatch(session, "Жим лёжа", "chosen");
  const matches = session.entries["0"]!.value!.exercises.filter((e) => session.entries["0"]!.mapping[e.id] === "chosen");
  assert.deepEqual(matches.map((e) => e.name), ["Жим лёжа"]);
  const one = table("Обычная", ["Жим"]); const found = detectLegacyMapping(one);
  assert.equal(normalizeLegacyTable(one, "file", found.header, found.mapping).exercises[0]!.id, "file:Обычная:exercise:жим");
});

test("I04 stored suggestions do nothing until selected, and a manual choice wins over later history", () => {
  const initial = startWorkbookReview(book([table("Первый", ["Тяга", "Жим"]), table("Второй", ["Тяга"])]), true);
  assert.deepEqual(initial.entries["0"]!.mapping, {});
  let session = setWorkbookNameMatch(initial, "Тяга", "old-target", "HISTORY");
  assert.deepEqual(workbookMatchesToRemember(session), [], "accepted existing history is not recorded as a new manual choice");
  session = setWorkbookNameMatch(session, "Тяга", "manual-target");
  session = setWorkbookNameMatch(session, "Тяга", "old-target", "HISTORY");
  assert.equal(session.nameMappings.get("Тяга")!.targetId, "manual-target");
  session = selectWorkbookSheet(session, "1");
  const exercise = session.entries["1"]!.value!.exercises[0]!;
  assert.equal(session.entries["1"]!.mapping[exercise.id], "manual-target");
  assert.deepEqual([...initial.nameMappings], [], "declining proposals and closing a file cannot mutate another session");
});

test("I04 unavailable history requires a fresh choice instead of silently falling back to automatic matching", () => {
  let session = startWorkbookReview(book([table("Первый", ["Тяга"]), table("Второй", ["Тяга"])]), true);
  const id = session.entries["0"]!.value!.exercises[0]!.id;
  session = updateWorkbookEntry(session, { mapping: { [id]: "automatic-target" } });
  session = requireWorkbookNameChoices(session, ["Тяга"]);
  assert.equal(session.entries["0"]!.mapping[id], undefined);
  assert.ok(session.manualRequiredNames.has("Тяга"));
  session = selectWorkbookSheet(session, "1");
  assert.ok(session.manualRequiredNames.has("Тяга"));
  session = setWorkbookNameMatch(session, "Тяга", "new-active-target");
  assert.ok(!session.manualRequiredNames.has("Тяга"));
  assert.equal(session.entries["0"]!.mapping[id], "new-active-target");
});

test("I04 partial confirmation applies only selected historical names, including when exact catalogue auto-matches existed", () => {
  let session = startWorkbookReview(book([table("Выбор", ["Тяга", "Жим"])]), true);
  const exercises = session.entries["0"]!.value!.exercises;
  session = updateWorkbookEntry(session, { mapping: Object.fromEntries(exercises.map((e) => [e.id, "automatic-target"])) });
  session = requireWorkbookNameChoices(session, ["Тяга", "Жим"]);
  assert.deepEqual(session.entries["0"]!.mapping, {});
  session = setWorkbookNameMatch(session, "Тяга", "confirmed-target", "HISTORY");
  assert.equal(session.entries["0"]!.mapping[exercises.find((e) => e.name === "Тяга")!.id], "confirmed-target");
  assert.equal(session.entries["0"]!.mapping[exercises.find((e) => e.name === "Жим")!.id], undefined);
  assert.ok(session.manualRequiredNames.has("Жим"));
});

test("I04 automatic catalogue matching is literal, unambiguous and cannot bypass declined historical suggestions", () => {
  let session = startWorkbookReview(book([table("Точные названия", ["Жим", "жим", "Жим лёжа", "Жим лежа"])]), true);
  const candidates = [{ id: "sys:press", name: "Жим", available: true }, { id: "sys:bench", name: "Жим лёжа", available: true }];
  session = autoMatchWorkbookEntry(session, candidates);
  const mappedNames = () => session.entries["0"]!.value!.exercises.filter((e) => session.entries["0"]!.mapping[e.id]).map((e) => e.name);
  assert.deepEqual(mappedNames(), ["Жим", "Жим лёжа"]);
  session = requireWorkbookNameChoices(session, ["Жим"]);
  session = autoMatchWorkbookEntry(session, candidates);
  assert.deepEqual(mappedNames(), ["Жим лёжа"]);
  const fresh = startWorkbookReview(book([table("Дубликаты", ["Жим"])]), true);
  assert.deepEqual(autoMatchWorkbookEntry(fresh, [...candidates, { id: "custom:press", name: "Жим", available: true }]).entries["0"]!.mapping, {});
});

test("I04 modal Back, header Back and repeated opening consume the catalogue filter before leaving the catalogue", async () => {
  const ref = createRef<CatalogBackHandle>(); let setOpen!: (open: boolean) => void;
  function Probe() { const [open, update] = useState(true); setOpen = update; useCatalogBack(ref, open, () => update(false)); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe)); });
  let page: ImportPage = "catalog";
  await act(async () => { page = previousImportPage(page, ref.current); });
  assert.equal(page, "catalog", "first Android request closes only the active filter");
  await act(async () => { page = previousImportPage(page, ref.current); });
  assert.equal(page, "review");
  await act(async () => { setOpen(true); }); page = "catalog";
  await act(async () => { page = previousImportPage(page, ref.current); });
  assert.equal(page, "catalog", "reopened filters remain dismissible by the same header handler");
  assert.equal(previousImportPage("create", null), "catalog");
  assert.equal(previousImportPage("review", null), null);
  await act(async () => { renderer.unmount(); });
  assert.equal(ref.current, null);
});

test("I04 every existing equipment item is searchable even with no matching exercises", () => {
  const all = equipmentChoices([]);
  for (const item of KNOWN_EQUIPMENT) assert.ok(all.includes(item));
  assert.ok(equipmentChoices([], [], "бабочка").includes("pec_deck"));
  assert.ok(equipmentChoices([], [], "ПЕК ДЕК").includes("pec_deck"));
  assert.ok(equipmentChoices([], [], "без оборудования").includes("none"));
  assert.ok(equipmentChoices([], ["custom_rig"], "custom rig").includes("custom_rig"));
  assert.deepEqual(equipmentChoices([], [], "несуществующий тренажёр"), []);
});

test("I04 selecting back muscles can produce zero results but cannot remove pec-deck equipment", () => {
  const entry: CatalogEntry = { overlay: EMPTY_OVERLAY, definition: { id: "sys:pec", origin: "SYSTEM", name: "Бабочка",
    nameEn: null, bodyPart: "shoulders", primaryMuscles: [], secondaryMuscles: [], equipment: "pec_deck", trackingProfile: "LOAD_REPS",
    mechanic: "isolation", difficulty: null, unilateral: false, variationGroup: null, instructions: [], tips: [], textLanguage: "ru", media: null, source: null } };
  const filters = { ...NO_FILTERS, bodyParts: new Set(["back" as const]) };
  assert.equal(filterCatalog([entry], "", "ALL", filters).length, 0);
  assert.equal(filterOptionCounts([entry], "", "ALL", filters, "equipment").get("pec_deck") ?? 0, 0);
  assert.ok(equipmentChoices([entry]).includes("pec_deck"));
});
