import assert from "node:assert/strict";
import test from "node:test";
import { backupMoment, backupSize } from "../apps/mobile/src/app/navigation/backupFormat.ts";

// Время задаётся в местных полях: результат не зависит от часового пояса машины.
const local = (year: number, month: number, day: number, hour: number, minute: number) => new Date(year, month - 1, day, hour, minute);

test("копия, сделанная сегодня, подписана «Сегодня, ЧЧ:ММ» (макет: «Сегодня, 09:12»)", () => {
  assert.equal(backupMoment(local(2026, 11, 9, 9, 12).toISOString(), local(2026, 11, 9, 23, 50)), "Сегодня, 09:12");
});

test("копия предыдущего дня — «Вчера», в том числе через полночь", () => {
  assert.equal(backupMoment(local(2026, 11, 8, 23, 59).toISOString(), local(2026, 11, 9, 0, 1)), "Вчера, 23:59");
});

test("более старая копия — дата ДД.ММ.ГГГГ и время", () => {
  assert.equal(backupMoment(local(2026, 11, 7, 7, 5).toISOString(), local(2026, 11, 9, 12, 0)), "07.11.2026, 07:05");
});

test("нечитаемая дата не ломает экран", () => {
  assert.equal(backupMoment("не дата", local(2026, 11, 9, 12, 0)), "—");
});

test("размер: 2 540 000 байт — 2481 КБ; от 10 МБ — в МБ с запятой (74 101 822 байт — 70,7 МБ)", () => {
  assert.equal(backupSize(2_540_000), "2481 КБ");
  assert.equal(backupSize(74_101_822), "70,7 МБ");
});
