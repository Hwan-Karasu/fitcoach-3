import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { ageOn } from "../apps/mobile/src/features/clients/domain/ClientProfileValidation.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

async function store() {
  const db = new DatabaseSync(":memory:");
  const clients = new DevClientRepository(new SharedSqliteDatabase(async () => nodeSqlitePort(db)), WS, []);
  await clients.initialize();
  return { db, clients };
}

test("возраст по дате рождения: 15.03.1989 на 20.10.2026 — 37; за день до дня рождения — на год меньше; без даты — null", () => {
  assert.equal(ageOn("1989-03-15", "2026-10-20"), 37);
  assert.equal(ageOn("1989-03-15", "2026-03-15"), 37, "в день рождения возраст уже новый");
  assert.equal(ageOn("1989-03-15", "2026-03-14"), 36);
  assert.equal(ageOn("2000-02-29", "2026-02-28"), 25, "29 февраля: до 1 марта в невисокосный год возраст ещё старый");
  assert.equal(ageOn("2000-02-29", "2026-03-01"), 26);
  assert.equal(ageOn(null, "2026-10-20"), null, "неизвестно — не ноль");
  assert.equal(ageOn("2026-10-21", "2026-10-20"), null, "дата рождения в будущем не даёт возраста");
  assert.equal(ageOn("не дата", "2026-10-20"), null);
});

test("пол клиента: сохраняется, по умолчанию не задан (null), правка без поля не затирает, явный null очищает", async () => {
  const { clients } = await store();
  const plain = await clients.create({ displayName: "SyntheticA" });
  assert.equal(plain.sex, null, "не введено — не угадывается");
  const created = await clients.create({ displayName: "SyntheticB", sex: "FEMALE", birthDate: "1989-03-15", heightCmX10: 1650 });
  assert.equal(created.sex, "FEMALE");
  const renamed = await clients.update(created.id, created.revision, { displayName: "SyntheticB2", birthDate: "1989-03-15", heightCmX10: 1650 });
  assert.equal(renamed.sex, "FEMALE", "поле не передано — прежнее значение сохраняется");
  const male = await clients.update(created.id, renamed.revision, { displayName: "SyntheticB2", sex: "MALE" });
  assert.equal(male.sex, "MALE");
  const cleared = await clients.update(created.id, male.revision, { displayName: "SyntheticB2", sex: null });
  assert.equal(cleared.sex, null, "явный null очищает");
  assert.equal((await clients.get(created.id))?.sex, null);
});

test("пол клиента: допустимы только MALE и FEMALE", async () => {
  const { clients } = await store();
  await assert.rejects(clients.create({ displayName: "SyntheticA", sex: "OTHER" as never }), code("CLIENT_SEX_INVALID"));
});
