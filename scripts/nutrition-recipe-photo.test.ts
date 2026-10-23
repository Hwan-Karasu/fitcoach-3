import assert from "node:assert/strict";
import test from "node:test";
import { photosToDiscard } from "../apps/mobile/src/features/nutrition/domain/RecipePhotoRules.ts";
import { RecipePhotoSession } from "../apps/mobile/src/features/nutrition/application/RecipePhotoSession.ts";
import { isLocalImageStoreUri } from "../apps/mobile/src/shared/media/LocalImagePath.ts";

const OLD = "file:///docs/local-images/old.jpg";
const A = "file:///docs/local-images/a.jpg";
const B = "file:///docs/local-images/b.jpg";

test("NUT-019 отмена редактора удаляет все выбранные копии, но не сохранённое ранее фото", () => {
  assert.deepEqual(photosToDiscard({ picked: [A, B], previous: OLD, current: B, saved: false }), [A, B]);
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: OLD, saved: false }), []);
});

test("NUT-019 запись с заменой: удаляются старое фото и промежуточные копии, итоговое остаётся", () => {
  assert.deepEqual([...photosToDiscard({ picked: [A, B], previous: OLD, current: B, saved: true })].sort(), [A, OLD]);
});

test("NUT-019 запись без изменения фото ничего не удаляет; «Убрать фото» удаляет прежнее", () => {
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: OLD, saved: true }), []);
  assert.deepEqual(photosToDiscard({ picked: [], previous: OLD, current: null, saved: true }), [OLD]);
  assert.deepEqual(photosToDiscard({ picked: [A], previous: null, current: A, saved: true }), []);
});

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const nextTick = () => Promise.resolve();

test("R06 фото: save/remove/повторный picker заблокированы до завершения копирования", async () => {
  const copy = deferred<string>(); const removed: string[] = []; let writes = 0; let secondPickerCalls = 0;
  const session = new RecipePhotoSession({ store: () => copy.promise, remove: (uri) => removed.push(uri) });
  session.setInitial(OLD);
  const picking = session.choosePhoto(async () => "picker");
  assert.equal(session.busy, true);
  assert.equal(await session.persist(async () => { writes++; }), false);
  assert.equal(session.removePhoto(), false);
  assert.equal(await session.choosePhoto(async () => { secondPickerCalls++; return "second"; }), null);
  copy.resolve(A); assert.equal(await picking, A);
  await session.persist(async (uri) => { assert.equal(uri, A); writes++; });
  session.dispose();
  assert.equal(writes, 1); assert.equal(secondPickerCalls, 0); assert.deepEqual(removed, [OLD]);
});

test("R06 фото: уход до ответа picker не начинает копирование", async () => {
  const select = deferred<string | null>(); const removed: string[] = []; let copies = 0;
  const session = new RecipePhotoSession({ store: async () => { copies++; return A; }, remove: (uri) => removed.push(uri) });
  session.setInitial(OLD);
  const picking = session.choosePhoto(() => select.promise);
  session.dispose(); select.resolve("picker");
  assert.equal(await picking, null); assert.equal(copies, 0); assert.deepEqual(removed, []);
});

test("R06 фото: поздняя готовая копия после unmount удаляется, сохранённая фотография остаётся", async () => {
  const copy = deferred<string>(); const removed: string[] = [];
  const session = new RecipePhotoSession({ store: () => copy.promise, remove: (uri) => removed.push(uri) });
  session.setInitial(OLD);
  const picking = session.choosePhoto(async () => "picker");
  await nextTick(); session.dispose(); copy.resolve(A);
  assert.equal(await picking, null); assert.deepEqual(removed, [A]);
});

for (const commit of [false, true]) test(`R06 фото: unmount во время DB save ждёт исход транзакции, commit=${commit}`, async () => {
  const write = deferred<void>(); const removed: string[] = [];
  const session = new RecipePhotoSession({ store: async () => A, remove: (uri) => removed.push(uri) });
  session.setInitial(OLD); await session.choosePhoto(async () => "picker");
  const saving = session.persist(async (uri) => { assert.equal(uri, A); await write.promise; });
  session.dispose(); assert.deepEqual(removed, [], "both images survive while the DB outcome is unknown");
  if (commit) { write.resolve(); assert.equal(await saving, true); assert.deepEqual(removed, [OLD]); }
  else { write.reject(new Error("RECIPE_STALE")); await assert.rejects(saving, /RECIPE_STALE/u); assert.deepEqual(removed, [A]); }
  session.dispose(); assert.equal(removed.length, 1, "cleanup is idempotent");
});

test("R06 фото: отмена picker и ошибка копии сохраняют предыдущий выбор для повторного save", async () => {
  const removed: string[] = []; let copies = 0;
  const session = new RecipePhotoSession({ store: async () => { if (++copies > 1) throw new Error("COPY_FAILED"); return A; }, remove: (uri) => removed.push(uri) });
  session.setInitial(OLD);
  await session.choosePhoto(async () => "picker");
  assert.equal(await session.choosePhoto(async () => null), null);
  await assert.rejects(session.choosePhoto(async () => "picker2"), /COPY_FAILED/u);
  assert.equal(session.busy, false);
  await session.persist(async (uri) => { assert.equal(uri, A); });
  session.dispose(); assert.deepEqual(removed, [OLD]);
});

test("R06 удаление локального фото принимает только файл своего плоского каталога", () => {
  const folder = "file:///docs/local-images/";
  assert.equal(isLocalImageStoreUri(A, folder), true);
  for (const uri of ["file:///docs/local-images-foreign/a.jpg", "file:///docs/local-images/../live.db",
    "file:///docs/local-images/%2e%2e%2flive.db", "file:///docs/local-images/%2e%2e", "file:///docs/local-images/a%5cb.jpg",
    "file:///docs/local-images/a.jpg?x=1", "file:///docs/local-images/a.jpg#x", "file:///docs/local-images/%",
    "file:///docs/local-images/a%00.jpg", folder, "file:///docs/live.db"]) {
    assert.equal(isLocalImageStoreUri(uri, folder), false, uri);
  }
});
