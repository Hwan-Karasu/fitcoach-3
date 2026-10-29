import assert from "node:assert/strict";
import test from "node:test";
import { acceptGroup, groupFresh, groupOf, stripState, type GroupRead } from
  "../apps/mobile/src/features/training/plans/domain/ParticipantGroupState.ts";

const A = JSON.stringify(["client", "A", "cycle-A"]);
const B = JSON.stringify(["client", "B", "cycle-B"]);
const ready = (place: string, version: number, members: readonly string[]): GroupRead<string> => ({ place, version, status: "ready", members });

test("PART-DOCK-1 состав другого места не выдаётся за состав открытого; загрузка — не «один участник»", () => {
  const readB = ready(B, 0, ["client"]);
  assert.deepEqual(groupOf(readB, B), ["client"]);
  assert.equal(groupOf(readB, A), null, "вернулись в A — состав B для A не годится");
  assert.equal(stripState(groupOf(readB, A)), "pending", "пока A читается, панель держит прежнее");
  assert.equal(stripState(["client"]), "none");
  assert.equal(stripState(["client", "other"]), "shown");
  assert.equal(stripState(["a", "b", "c"]), "shown", "три участника — тоже полоса");
  assert.equal(stripState(null, true), "none", "не прочиталось — строки нет до повтора, а не чужая строка");
});

test("PART-DOCK-1 поздний ответ прежнего места или прежней версии отбрасывается", () => {
  const current = ready(A, 1, ["client", "other"]);
  const lateB = ready(B, 0, ["client"]);
  assert.equal(acceptGroup(current, lateB, { place: A, version: 1 }), current, "поздний ответ B после перехода в A");
  const older = ready(A, 0, ["client"]);
  assert.equal(acceptGroup(current, older, { place: A, version: 1 }), current, "ответ до изменения состава");
  const fresh = ready(A, 2, ["client", "other", "third"]);
  assert.equal(acceptGroup(current, fresh, { place: A, version: 2 }), fresh, "состав изменился при открытом экране");
  const failed: GroupRead<string> = { place: A, version: 3, status: "error" };
  assert.equal(groupOf(acceptGroup(fresh, failed, { place: A, version: 3 }), A), null);
});

test("PART-DOCK-1 выбор участника открыт только по составу последней версии этого места", () => {
  const read = ready(A, 1, ["client", "other"]);
  assert.equal(groupFresh(read, A, 1), true);
  assert.equal(groupFresh(read, A, 2), false, "план изменился — ждём новое чтение");
  assert.equal(groupFresh(read, B, 1), false);
  assert.deepEqual(groupOf(read, A), ["client", "other"], "прежний состав этого же места остаётся видимым, без мигания");
});
