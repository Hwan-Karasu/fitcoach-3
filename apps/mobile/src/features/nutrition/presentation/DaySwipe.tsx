import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { daySwipeOf, swipedDay, type DaySwipeDirection } from "../domain/DayNavigation.ts";
import { useClientDay } from "./ClientDay.tsx";

/** Путь пальца, dp, на который лента дней сдвигается на целую колонку: палец ведёт ленту, а не содержимое. */
const STRIP_DRAG_SPAN = 180;

/**
 * Свайп влево/вправо по содержимому дня — карусель дней «Вчера · Сегодня · Завтра · …» (UIX-FIT-10, UI-OWN-070, UIX-FIT-11): влево — вперёд, вправо — назад.
 * Содержимое не двигается и не гаснет: меняются только значения дня на месте, а плавно едет лента дней сверху (`DayTabs`, общий `stripShift`).
 * Вертикальная прокрутка не мешает (жест отказывает при вертикальном движении); краёв у дней нет. Что значит «соседний день» — в `swipedDay`.
 */
export function DaySwipe({ children }: Readonly<{ children: ReactNode }>) {
  const { day, today, setDay, stripShift } = useClientDay();
  // Актуальные день и «сегодня» читаются из ref: быстрый второй свайп до перерисовки не должен брать устаревший день.
  const current = useRef({ day, today }); current.current = { day, today };
  const handle = useCallback((swipe: DaySwipeDirection) => {
    const next = swipedDay(current.current.day, current.current.today, swipe);
    if (next === null) { stripShift.value = withSpring(0, { damping: 24, stiffness: 340 }); return; }
    // `setDay` продолжает ленту с того места, где её оставил палец, и возвращает её в 0 анимацией.
    setDay(next);
    current.current = { day: next, today: current.current.today };
  }, [setDay, stripShift]);
  // Положение ленты в начале жеста: новый свайп посреди слайда продолжает её с места, а не бросает к нулю.
  const startShift = useSharedValue(0);
  const gesture = useMemo(() => Gesture.Pan().activeOffsetX([-24, 24]).failOffsetY([-14, 14])
    .onBegin(() => {
      "worklet";
      cancelAnimation(stripShift);
      startShift.value = stripShift.value;
    })
    .onUpdate((event) => {
      "worklet";
      stripShift.value = Math.min(1, Math.max(-1, startShift.value + event.translationX / STRIP_DRAG_SPAN));
    })
    .onEnd((event, success) => {
      "worklet";
      // Отменённый системой жест день не переключает.
      const swipe = success ? daySwipeOf(event.translationX, event.velocityX) : null;
      if (swipe === null) stripShift.value = withSpring(0, { damping: 24, stiffness: 340 });
      else scheduleOnRN(handle, swipe);
    })
    .onFinalize((_event, success) => {
      "worklet";
      if (!success) stripShift.value = withSpring(0, { damping: 24, stiffness: 340 });
    }), [stripShift, startShift, handle]);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.fill}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
