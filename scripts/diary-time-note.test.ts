import assert from "node:assert/strict";
import test from "node:test";
import { diaryTimeNote } from "../apps/mobile/src/features/training/execution/domain/DiaryTimeNote.ts";

const at = (time: string) => `2026-10-20T${time}:00.000Z`;

test("no date: the line explains that time needs a date", () => {
  assert.equal(diaryTimeNote({ actualDate: null, startedAt: null, finishedAt: null }), "Для времени сначала укажите дату");
});

test("a date without time marks: the line stays empty (the space is still reserved by the screen)", () => {
  assert.equal(diaryTimeNote({ actualDate: "2026-10-20", startedAt: null, finishedAt: null }), "");
  assert.equal(diaryTimeNote({ actualDate: "2026-10-20", startedAt: at("10:00"), finishedAt: null }), "");
});

test("both marks: the duration, with the seconds rounded to minutes", () => {
  assert.equal(diaryTimeNote({ actualDate: "2026-10-20", startedAt: at("10:00"), finishedAt: at("11:05") }), "1 ч 05 мин");
  assert.equal(diaryTimeNote({ actualDate: "2026-10-20", startedAt: at("10:00"), finishedAt: at("10:45") }), "45 мин");
});

test("end before start is «no data», not an invented duration", () => {
  assert.equal(diaryTimeNote({ actualDate: "2026-10-20", startedAt: at("11:00"), finishedAt: at("10:00") }), "Длительность: нет данных");
});

test("two marks win over a missing date: the duration is data, the hint is only guidance", () => {
  assert.equal(diaryTimeNote({ actualDate: null, startedAt: at("10:00"), finishedAt: at("10:30") }), "30 мин");
});
