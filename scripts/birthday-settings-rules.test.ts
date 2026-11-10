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
import { BirthdaySettingsSaveQueue } from "../apps/mobile/src/features/clients/presentation/BirthdaySettingsSaveQueue.ts";

test("UIX audit: сбой настройки не теряет следующий выбор и не сохраняет неуспешный патч повторно", async () => {
  let saved = { birthdayPinEnabled: false, birthdayPinLeadDays: 14, showBirthdayBadge: true };
  let fail!: (error: Error) => void;
  let calls = 0;
  const queue = new BirthdaySettingsSaveQueue({ getBirthdaySettings: async () => ({ ...saved }), setBirthdaySettings: async (next) => {
    calls += 1;
    if (calls === 1) return new Promise<void>((_resolve, reject) => { fail = reject; });
    saved = { ...next };
  } });
  await queue.load();
  const first = queue.commit({ birthdayPinEnabled: true })!;
  const rejected = assert.rejects(first.result, /IO/u);
  await Promise.resolve();
  const second = queue.commit({ showBirthdayBadge: false })!;
  fail(new Error("IO"));
  await rejected;
  await second.result;
  assert.deepEqual(saved, { birthdayPinEnabled: false, birthdayPinLeadDays: 14, showBirthdayBadge: false });
  assert.deepEqual(queue.value, saved);
  assert.equal(queue.isLatest(first.sequence), false);
});
