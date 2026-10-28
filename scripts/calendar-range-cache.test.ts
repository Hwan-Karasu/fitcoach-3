import assert from "node:assert/strict";
import test from "node:test";
import type { Appointment, CalendarInterval } from "../apps/mobile/src/features/calendar/domain/CalendarModel.ts";
import { RangeCache } from "../apps/mobile/src/features/calendar/domain/CalendarRangeCache.ts";

// CAL-RANGE-CACHE: переключение «неделя ↔ день» берёт уже прочитанные записи; кэш ограничен, чтобы память не росла со временем.
const appointment = (id: string, localDate: string) => ({ id, localDate }) as unknown as Appointment;
const interval = (id: string, localDate: string) => ({ id, localDate }) as unknown as CalendarInterval;
const week = { appointments: [appointment("a", "2026-10-26"), appointment("b", "2026-10-28"), appointment("c", "2026-10-28")],
  intervals: [interval("d", "2026-10-27"), interval("e", "2026-10-28")] };

test("точное совпадение диапазона возвращается как есть; чужой диапазон — промах", () => {
  const cache = new RangeCache(4);
  cache.put("2026-10-26", "2026-11-01", week);
  assert.equal(cache.get("2026-10-26", "2026-11-01"), week);
  assert.equal(cache.get("2026-11-02", "2026-11-08"), null);
});

test("день берётся из закэшированной недели без запроса: только записи и интервалы этого дня", () => {
  const cache = new RangeCache(4);
  cache.put("2026-10-26", "2026-11-01", week);
  const day = cache.get("2026-10-28", "2026-10-28")!;
  assert.deepEqual(day.appointments.map((row) => row.id), ["b", "c"]);
  assert.deepEqual(day.intervals.map((row) => row.id), ["e"]);
  assert.deepEqual(cache.get("2026-10-29", "2026-10-29")!.appointments, [], "пустой день из кэшированной недели — тоже попадание");
});

test("изменение календаря сбрасывает пересекающиеся диапазоны, остальные остаются; ALL сбрасывает всё", () => {
  const cache = new RangeCache(4);
  cache.put("2026-10-26", "2026-11-01", week);
  cache.put("2026-11-02", "2026-11-08", { appointments: [], intervals: [] });
  cache.invalidate(["2026-10-28"]);
  assert.equal(cache.get("2026-10-28", "2026-10-28"), null);
  assert.notEqual(cache.get("2026-11-02", "2026-11-08"), null);
  cache.invalidate("ALL");
  assert.equal(cache.size, 0);
});

test("лимит: самый давно не использованный диапазон вытесняется, использованный недавно остаётся", () => {
  const cache = new RangeCache(2);
  const empty = { appointments: [], intervals: [] };
  cache.put("2026-01-05", "2026-01-11", empty);
  cache.put("2026-01-12", "2026-01-18", empty);
  cache.get("2026-01-05", "2026-01-11");
  cache.put("2026-01-19", "2026-01-25", empty);
  assert.equal(cache.size, 2);
  assert.notEqual(cache.get("2026-01-05", "2026-01-11"), null, "недавно использованный остался");
  assert.equal(cache.get("2026-01-12", "2026-01-18"), null, "давно не использованный вытеснен");
});

test("чтение, начатое до изменения календаря, не записывает устаревший результат в кэш", () => {
  const cache = new RangeCache(4);
  const startedAt = cache.version;
  cache.invalidate(["2026-10-28"]);
  cache.put("2026-10-26", "2026-11-01", week, startedAt);
  assert.equal(cache.size, 0, "результат чтения до сброса отброшен");
  cache.put("2026-10-26", "2026-11-01", week, cache.version);
  assert.equal(cache.size, 1, "чтение после сброса сохраняется");
});
