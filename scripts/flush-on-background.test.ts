import assert from "node:assert/strict";
import test from "node:test";
import { flushOnBackground, type AppStateSource } from "../apps/mobile/src/shared/runtime/flushOnBackground.ts";
import { PendingInputWrites } from "../apps/mobile/src/features/training/execution/domain/PendingInputWrites.ts";
import { RecoveryDraftQueue } from "../apps/mobile/src/features/training/plans/domain/RecoveryDraftQueue.ts";

/** Внешняя граница — состояние приложения ОС; таймеры JS в фоне Android не срабатывают, поэтому тесты их не ждут. */
function appState() {
  const listeners = new Set<(state: string) => void>();
  const source: AppStateSource = { addEventListener: (_type, listener) => { listeners.add(listener); return { remove: () => { listeners.delete(listener); } }; } };
  return { source, emit: (state: string) => { for (const listener of [...listeners]) listener(state); }, get count() { return listeners.size; } };
}

test("ARCH-HARDEN-1c: уход приложения из активного состояния сразу дописывает отложенный ввод; возврат и отписка записи не вызывают", () => {
  const app = appState();
  let flushed = 0;
  const off = flushOnBackground(app.source, () => { flushed += 1; });
  app.emit("active");
  assert.equal(flushed, 0, "возврат в приложение ничего не пишет");
  app.emit("background");
  assert.equal(flushed, 1);
  app.emit("inactive");
  assert.equal(flushed, 2, "каждый уход — повторная попытка: предыдущая могла не дописать");
  off();
  assert.equal(app.count, 0, "слушатель снят");
  app.emit("background");
  assert.equal(flushed, 2);
});

test("ARCH-HARDEN-1c: ввод подхода, набранный перед блокировкой экрана, записывается без срабатывания таймера и ровно один раз", async () => {
  const app = appState();
  const pending = new PendingInputWrites();
  const saved: number[] = [];
  // Ячейка зарегистрировала запись и ждёт 700 мс таймера, который в фоне не сработает.
  pending.set("slot|set-1:reps", async () => { saved.push(12); return true; });
  const off = flushOnBackground(app.source, () => pending.flushAll());
  try {
    app.emit("background");
    await pending.flushAll();
    assert.deepEqual(saved, [12]);
    assert.equal(pending.dirty, false);
    app.emit("active"); app.emit("background");
    await pending.flushAll();
    assert.deepEqual(saved, [12], "повторное сворачивание не дублирует запись");
  } finally { off(); }
});

test("ARCH-HARDEN-1c: черновик конструктора, изменённый перед сворачиванием, сохраняется сразу и один раз", async () => {
  const app = appState();
  const written: string[] = [];
  const errors: unknown[] = [];
  const queue = new RecoveryDraftQueue<string>(async (value) => { written.push(value); }, (error) => { errors.push(error); });
  const off = flushOnBackground(app.source, () => queue.flush());
  try {
    queue.schedule("черновик-1");
    queue.schedule("черновик-2");
    app.emit("background");
    await queue.flush();
    assert.deepEqual(written, ["черновик-2"], "сохранено последнее значение, без ожидания 800 мс");
    app.emit("background");
    await queue.flush();
    assert.deepEqual(written, ["черновик-2"]);
    assert.deepEqual(errors, []);
  } finally { off(); queue.dispose(); }
});
