import assert from "node:assert/strict";
import test from "node:test";
import { forcedClosedAfter, keyboardInset } from "../apps/mobile/src/shared/ui/components/keyboardInsetRules.ts";

// Экран 800 dp, клавиатура 280 dp (её верх на 520 dp).
test("KBD-GAP-1: отступ равен части контейнера, перекрытой клавиатурой, и следует за её анимацией", () => {
  assert.equal(keyboardInset(800, 800, 280, 1, false), 280, "контейнер до низа экрана");
  assert.equal(keyboardInset(800, 800, 280, 0.5, false), 140, "середина анимации");
  assert.equal(keyboardInset(800, 800, 280, 0, false), 0, "клавиатура закрыта");
  assert.equal(keyboardInset(740, 800, 280, 1, false), 220, "под контейнером 60 dp чужого места");
  assert.equal(keyboardInset(400, 800, 280, 1, false), 0, "клавиатура не доходит до контейнера");
});

test("KBD-GAP-1: клавиатура исчезла без события библиотеки (блокировка экрана) — отступ обнуляется сигналом «скрыта»", () => {
  // Состояние библиотеки застряло: прогресс 1, высота 280 — на экране была пустая полоса 280 dp под нижней панелью.
  let forced = false;
  assert.equal(keyboardInset(800, 800, 280, 1, forced), 280);
  forced = forcedClosedAfter(forced, { kind: "HIDDEN" });
  assert.equal(keyboardInset(800, 800, 280, 1, forced), 0);
  // Событие библиотеки с нулевой высотой сигнал не отменяет.
  forced = forcedClosedAfter(forced, { kind: "KEYBOARD", height: 0 });
  assert.equal(keyboardInset(800, 800, 280, 1, forced), 0);
});

test("KBD-GAP-1: следующий показ клавиатуры снова ведёт отступ; запоздавший сигнал «скрыта» снимается ближайшим событием показа", () => {
  let forced = forcedClosedAfter(false, { kind: "HIDDEN" });
  forced = forcedClosedAfter(forced, { kind: "KEYBOARD", height: 280 });
  assert.equal(keyboardInset(800, 800, 280, 0.25, forced), 70);
  // Сигнал от прежнего закрытия дошёл до потока интерфейса уже во время показа.
  forced = forcedClosedAfter(forced, { kind: "HIDDEN" });
  assert.equal(keyboardInset(800, 800, 280, 0.5, forced), 0);
  forced = forcedClosedAfter(forced, { kind: "KEYBOARD", height: 150 });
  assert.equal(keyboardInset(800, 800, 280, 0.75, forced), 210, "поле ввода не остаётся под клавиатурой");
});

test("KBD-GAP-1: клавиатура вернулась без события библиотеки (разблокировка экрана) — сигнал «показана» возвращает отступ", () => {
  // Библиотека помнит прошлый показ (прогресс 1, высота 280); отступ был обнулён сигналом «скрыта».
  let forced = forcedClosedAfter(false, { kind: "HIDDEN" });
  assert.equal(keyboardInset(800, 800, 280, 1, forced), 0);
  forced = forcedClosedAfter(forced, { kind: "SHOWN" });
  assert.equal(keyboardInset(800, 800, 280, 1, forced), 280, "поле ввода не под клавиатурой");
});
