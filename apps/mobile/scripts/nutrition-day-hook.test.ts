import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createElement } from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevNutritionDiaryRepository } from "../src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { DevNutritionTargetsRepository } from "../src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import type { FoodProduct } from "../src/features/nutrition/domain/FoodModel.ts";
import { snapshotOfFood } from "../src/features/nutrition/domain/FoodSnapshot.ts";
import type { NutritionDiaryPort } from "../src/features/nutrition/domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../src/features/nutrition/domain/NutritionTargetsPort.ts";
import { useNutritionDay, type NutritionDayData } from "../src/features/nutrition/presentation/useNutritionDay.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");
const DAY = "2026-10-20";
const PAST = "2026-10-12";
/** На 100 г: 360 ккал (литерал из примера, не пересчёт кодом). */
const OATS: FoodProduct = { id: "food-oats", name: "Овсянка", brand: null, unit: "G", amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600,
  revision: 1, archivedAt: null };

type Result = Readonly<{ data: NutritionDayData | null; stale: boolean; failed: boolean }>;

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const diary = new DevNutritionDiaryRepository(shared, WS);
  await diary.initialize();
  const targets = new DevNutritionTargetsRepository(shared, WS);
  await targets.initialize();
  const close = async () => { await targets.close(); await diary.close(); await clients.close(); };
  return { clients, diary, targets, close };
}

interface Sink { current: Result | null; readonly frames: Result[] }
const newSink = (): Sink => ({ current: null, frames: [] });

/** Пустышка с хуком (один и тот же компонент на всех кадрах, иначе состояние хука пересоздаётся): результат — в `sink`. */
function Probe(props: Readonly<{ clientId: string; localDate: string; diary: NutritionDiaryPort; targets: NutritionTargetsPort; sink: Sink }>) {
  const { data, stale, failed } = useNutritionDay(props.clientId, props.localDate, props.diary, props.targets);
  props.sink.current = { data, stale, failed };
  props.sink.frames.push(props.sink.current);
  return null;
}
/** Даёт промисам чтения завершиться и React применить обновления. */
/** Изменение хранилища внутри act: подписчики хука обновляют состояние, предупреждений «вне act» нет. */
async function change<T>(work: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => { result = await work(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  return result;
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

test("хук дня: после фиксации изменений итоги обновляются, возврат на правленую дату показывает новые данные", async () => {
  const { clients, diary, targets, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticHook" });
    const sink = newSink();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(createElement(Probe, { clientId: client.id, localDate: DAY, diary, targets, sink })); });
    await settle();
    assert.equal(sink.current?.data?.summary.state, "NO_FOOD");
    // Запись на показанный день: итог обновляется без ручной перезагрузки.
    const entry = await change(() => diary.addEntry(client.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW));
    assert.equal(sink.current?.data?.summary.totals.kcalX10, 1800, "50 г овсянки = 180 ккал");
    // Прошлая дата: перейти, изменить её, перейти на другую и вернуться — правка видна.
    await act(async () => { renderer.update(createElement(Probe, { clientId: client.id, localDate: PAST, diary, targets, sink })); });
    await settle();
    const past = await change(() => diary.addEntry(client.id, { localDate: PAST, slot: "DINNER", snapshot: snapshotOfFood(OATS, 1000) }, NOW));
    assert.equal(sink.current?.data?.summary.totals.kcalX10, 3600);
    await act(async () => { renderer.update(createElement(Probe, { clientId: client.id, localDate: DAY, diary, targets, sink })); });
    await settle();
    await change(() => diary.editEntry(client.id, past.id, past.revision, { quantityX10: 2000, slot: "DINNER", override: null }, NOW));
    await act(async () => { renderer.update(createElement(Probe, { clientId: client.id, localDate: PAST, diary, targets, sink })); });
    await settle();
    assert.equal(sink.current?.data?.summary.totals.kcalX10, 7200, "правка прошлой даты видна после возврата на неё");
    assert.equal(sink.current?.data?.entries.length, 1);
    // Вода: меняет только воду, итог еды прежний.
    await change(() => diary.setWater(client.id, PAST, 750, NOW));
    assert.equal(sink.current?.data?.waterMl, 750);
    assert.equal(sink.current?.data?.summary.totals.kcalX10, 7200);
    // Удаление последней записи дня выводит день из учёта.
    await act(async () => { renderer.update(createElement(Probe, { clientId: client.id, localDate: DAY, diary, targets, sink })); });
    await settle();
    await change(() => diary.removeEntry(client.id, entry.id, entry.revision));
    assert.equal(sink.current?.data?.summary.state, "NO_FOOD");
    await act(async () => { renderer.unmount(); });
  } finally { await close(); }
});

test("хук дня: при смене клиента данные прежнего клиента не показываются ни как итог, ни как «прежний день»", async () => {
  const { clients, diary, targets, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticHookA" });
    const b = await clients.create({ displayName: "SyntheticHookB" });
    await diary.addEntry(a.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(OATS, 500) }, NOW);
    const sink = newSink();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(createElement(Probe, { clientId: a.id, localDate: DAY, diary, targets, sink })); });
    await settle();
    assert.equal(sink.current?.data?.summary.totals.kcalX10, 1800);
    const framesBefore = sink.frames.length;
    await act(async () => { renderer.update(createElement(Probe, { clientId: b.id, localDate: DAY, diary, targets, sink })); });
    await settle();
    assert.equal(sink.current?.data?.summary.state, "NO_FOOD", "у клиента B за этот день еды нет");
    assert.equal(sink.current?.data?.entries.length, 0);
    assert.equal(sink.frames.slice(framesBefore).some((frame) => frame.data?.summary.totals.kcalX10 === 1800), false, "на кадрах после смены клиента значений клиента A не было");
    await act(async () => { renderer.unmount(); });
  } finally { await close(); }
});
