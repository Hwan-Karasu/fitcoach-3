import assert from "node:assert/strict";
import test from "node:test";
import { datePickSnapshot, finishDatePick, registerDatePickHost, requestDate } from "../apps/mobile/src/shared/ui/components/datePickStore.ts";

// Промис выбора даты обязан завершаться всегда: дата, отмена, второй запрос вместо первого, отсутствие хоста.
test("выбор даты: без хоста — сразу null, а не зависание", async () => {
  assert.equal(await requestDate({ value: "2026-11-11" }), null);
  assert.equal(datePickSnapshot(), null);
});

test("выбор даты: «Готово» возвращает дату, «Отмена» — null", async () => {
  const unregister = registerDatePickHost();
  try {
    const first = requestDate({ value: "2026-11-11", max: "2026-11-30", title: "Дата" });
    assert.equal(datePickSnapshot()?.title, "Дата");
    finishDatePick("2026-11-13");
    assert.equal(await first, "2026-11-13");
    assert.equal(datePickSnapshot(), null);
    const second = requestDate({ value: "2026-11-11" });
    finishDatePick(null);
    assert.equal(await second, null);
  } finally { unregister(); }
});

test("выбор даты: новый запрос отменяет прежний, закрытие хоста завершает открытый запрос", async () => {
  const unregister = registerDatePickHost();
  const first = requestDate({ value: "2026-11-01" });
  const second = requestDate({ value: "2026-11-02" });
  assert.equal(await first, null, "прежний отменён");
  assert.equal(datePickSnapshot()?.value, "2026-11-02");
  unregister();
  assert.equal(await second, null, "хост закрыт — запрос завершён");
});
