import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_GAP, CARD_PADDING, compactTimerCount, MIN_ACTION_WIDTH, orderedRestTimers, retainedTimerOffset, restPanelMode, TIMER_GAP, timerCarouselLayout,
  timerCarouselPosition, timerCountLabel, timerInitials } from "../apps/mobile/src/features/training/execution/presentation/restPanelRules.ts";
import { adjustTimer, pauseTimer, startTimer, type RestTimerStart } from "../apps/mobile/src/features/training/execution/domain/RestTimerRules.ts";
import { RestFinishTracker } from "../apps/mobile/src/features/training/execution/domain/RestFinishTracker.ts";
import { createSlotStore } from "../apps/mobile/src/shared/ui/components/slotStore.ts";

const input: RestTimerStart = { clientId: "synthetic-a", clientName: "Synthetic A", exerciseKey: "e1", exerciseName: "Row",
  durationSec: 60, programId: "p1", weekIndex: 1, plannedWorkoutId: "w1" };

test("REST-DOCK-2: новый и окончившийся таймеры не меняют выбранный свёрнутый режим, исчезновение не оставляет область", () => {
  const first = startTimer([], input, "t1", 0).timers;
  const second = startTimer(first, { ...input, clientId: "synthetic-b", exerciseKey: "e2" }, "t2", 1).timers;
  assert.equal(restPanelMode("expanded", 0), "hidden");
  assert.equal(restPanelMode("expanded", first.length), "expanded");
  assert.equal(restPanelMode("collapsed", first.length), "collapsed");
  assert.equal(restPanelMode("collapsed", second.length), "collapsed");
  const tracker = new RestFinishTracker();
  assert.equal(tracker.observe(second, 60_001).length, 2);
  assert.equal(restPanelMode("collapsed", second.length), "collapsed");
  assert.equal(tracker.observe(second, 60_002).length, 0);
  assert.equal(restPanelMode("collapsed", 0), "hidden");
  assert.equal(restPanelMode("collapsed", first.length), "collapsed");
});

test("REST-DOCK-2: порядок владельцев/упражнений не меняется от ±15, паузы и секунд", () => {
  const a = startTimer([], input, "a", 0).timer;
  const b = startTimer([], { ...input, clientId: "synthetic-b" }, "b", 100).timer;
  const c = startTimer([], { ...input, exerciseKey: "e2" }, "c", 200).timer;
  const changed = [pauseTimer(c, 500), adjustTimer(a, 15, 500), adjustTimer(b, -15, 500)];
  assert.deepEqual(orderedRestTimers(changed).map((t) => [t.id, t.clientId, t.exerciseKey]),
    [["a", "synthetic-a", "e1"], ["b", "synthetic-b", "e1"], ["c", "synthetic-a", "e2"]]);
});

test("REST-DOCK-3: один таймер на всю ширину; два рядом, если помещаются кнопки не уже 34 dp, иначе край следующей карточки", () => {
  for (const screenWidth of [320, 360, 412]) for (const scale of [1, 1.3, 2]) {
    const width = screenWidth - 16; // Internal padding of the full-width shared bottom panel.
    assert.equal(timerCarouselLayout(width, 1, scale).cardWidth, width);
    assert.equal(timerCarouselLayout(width, 1, scale).stops, 1);
    for (const count of [2, 3, 5]) {
      const layout = timerCarouselLayout(width, count, scale);
      const buttonWidth = (layout.cardWidth - 2 * CARD_PADDING - 3 * ACTION_GAP) / 4;
      assert.ok(buttonWidth >= MIN_ACTION_WIDTH, `четыре кнопки карточки не уже ${MIN_ACTION_WIDTH} dp: ${screenWidth}/${scale}/${count} → ${buttonWidth}`);
      assert.ok(layout.cardWidth <= width);
    }
  }
  // Телефон 360 dp (панель 344), обычный шрифт: два таймера — две полные карточки рядом, без прокрутки (макет, сценарий 2).
  const two = timerCarouselLayout(344, 2, 1);
  assert.equal(two.cardWidth, 168);
  assert.equal(two.stops, 1);
  assert.equal(two.maxOffset, 0);
  // Три и больше: две полные карточки и край третьей, индикатор показывает позиции (макет, сценарий 4).
  for (const count of [3, 4, 5]) {
    const layout = timerCarouselLayout(344, count, 1);
    assert.equal(layout.cardWidth, 156);
    assert.ok(2 * layout.cardWidth + 2 * TIMER_GAP < 344, "край следующей карточки виден");
    assert.ok(layout.maxOffset > 0);
    assert.ok(layout.stops >= 2);
    assert.equal(timerCarouselPosition(layout.maxOffset, layout.step, layout.maxOffset, layout.stops), layout.stops - 1);
  }
  // Узкий экран 320 dp: две полные карточки не помещаются — одна почти во всю ширину и край второй.
  const narrow = timerCarouselLayout(304, 2, 1);
  assert.ok(narrow.cardWidth > 156 && narrow.cardWidth < 304);
  assert.ok(narrow.stops >= 2);
  // Широкий экран: три таймера помещаются рядом.
  const tablet = timerCarouselLayout(600, 3, 1);
  assert.equal(tablet.stops, 1);
  for (const width of [600, 800]) for (const scale of [1, 1.3, 2]) {
    const layout = timerCarouselLayout(width, 8, scale);
    assert.ok(layout.cardWidth >= 156);
    assert.ok(layout.maxOffset > 0);
    assert.ok(layout.stops >= 2);
  }
});

test("REST-DOCK-2: компактная строка учитывает аватары, масштаб и динамический остаток", () => {
  assert.equal(compactTimerCount(320, 1, false, 1), 1);
  assert.equal(compactTimerCount(320, 2, false, 1), 2);
  assert.equal(compactTimerCount(320, 5, false, 1), 1);
  assert.equal(compactTimerCount(360, 5, true, 1), 1);
  assert.equal(compactTimerCount(320, 5, true, 2), 0);
  assert.equal(compactTimerCount(800, 5, true, 1), 5);
  assert.deepEqual([1, 2, 5, 11, 21].map(timerCountLabel), ["1 таймер", "2 таймера", "5 таймеров", "11 таймеров", "21 таймер"]);
  assert.equal(timerInitials("Телепнев Сергей"), "ТС");
});

test("REST-DOCK-2: удаление карточки сохраняет видимый якорь или ближайшего соседа", () => {
  assert.equal(retainedTimerOffset(["a", "b", "c", "d", "e"], ["b", "c", "d", "e"], 300, 150, 300), 150);
  assert.equal(retainedTimerOffset(["a", "b", "c", "d", "e"], ["a", "b", "d", "e"], 300, 150, 300), 300);
  assert.equal(retainedTimerOffset(["a", "b", "c"], ["a"], 300, 150, 0), 0);
  assert.equal(retainedTimerOffset(["a"], [], 0, 150, 0), 0);
  assert.equal(retainedTimerOffset(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"], 300, 300, 900, 150), 600,
    "смена ширины карточки сохраняет тот же таймер, а не прежнее число пикселей");
});

test("REST-DOCK-2: уход прежнего навигатора не удаляет кнопки нового; снимок стабилен без изменений", () => {
  const store = createSlotStore<string>();
  store.set("root", "clients");
  store.set("workspace", "training");
  store.remove("root");
  assert.equal([...store.getSnapshot().values()].at(-1), "training");
  const snapshot = store.getSnapshot();
  store.set("workspace", "training");
  store.remove("root");
  assert.equal(store.getSnapshot(), snapshot);
  store.remove("workspace");
  assert.equal(store.getSnapshot().size, 0);
});
