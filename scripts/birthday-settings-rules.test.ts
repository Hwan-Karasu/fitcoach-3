import assert from "node:assert/strict";
import test from "node:test";
import { nextBirthdaySettings, parseBirthdayLeadDays } from "../apps/mobile/src/features/clients/domain/BirthdaySettingsRules.ts";

test("UIX-13: «за сколько дней» — целое от 1 до 60; пустое, дробное, ноль, 61 и буквы — ошибка", () => {
  assert.equal(parseBirthdayLeadDays("14"), 14);
  assert.equal(parseBirthdayLeadDays(" 7 "), 7);
  assert.equal(parseBirthdayLeadDays("1"), 1);
  assert.equal(parseBirthdayLeadDays("60"), 60);
  for (const bad of ["", "0", "61", "100", "1,5", "-3", "ab", "7 дней"]) assert.equal(parseBirthdayLeadDays(bad), null, bad);
});

test("UIX-13: запись сразу при изменении — без изменений записи нет, иначе сливаются сохранённое и правка", () => {
  const saved = { birthdayPinEnabled: true, birthdayPinLeadDays: 14, showBirthdayBadge: true };
  assert.equal(nextBirthdaySettings(saved, {}), null);
  assert.equal(nextBirthdaySettings(saved, { birthdayPinLeadDays: 14 }), null);
  assert.deepEqual(nextBirthdaySettings(saved, { birthdayPinEnabled: false }), { birthdayPinEnabled: false, birthdayPinLeadDays: 14, showBirthdayBadge: true });
  assert.deepEqual(nextBirthdaySettings(saved, { birthdayPinLeadDays: 30 }), { birthdayPinEnabled: true, birthdayPinLeadDays: 30, showBirthdayBadge: true });
});
