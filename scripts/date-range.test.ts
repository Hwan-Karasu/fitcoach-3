import assert from "node:assert/strict";
import test from "node:test";
import { localDateOfPicker, localMidnight } from "../apps/mobile/src/shared/ui/components/dateRange.ts";

test("дата календаря → локальная YYYY-MM-DD: Date, объект с toDate, строка; пусто и мусор — null", () => {
  assert.equal(localDateOfPicker(new Date(2026, 9, 5, 23, 59)), "2026-10-05", "поздний вечер не переходит на следующий день");
  assert.equal(localDateOfPicker({ toDate: () => new Date(2026, 0, 31, 14) } as never), "2026-01-31", "Dayjs-подобное значение");
  assert.equal(localDateOfPicker("2026-02-28T10:00:00"), "2026-02-28");
  assert.equal(localDateOfPicker(null), null);
  assert.equal(localDateOfPicker(undefined), null);
  assert.equal(localDateOfPicker("не дата"), null);
});

test("локальная полночь без сдвига часового пояса", () => {
  const date = localMidnight("2026-03-01");
  assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()], [2026, 2, 1, 0]);
});
