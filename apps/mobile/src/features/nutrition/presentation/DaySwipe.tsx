import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { daySwipeOf, swipedDay, type DaySwipeDirection } from "../domain/DayNavigation.ts";
import { useClientDay } from "./ClientDay.tsx";

/** Сдвиг содержимого при смене дня: новый день «въезжает» с той стороны, куда ушёл палец. */
const ENTER_SHIFT = 36;
/** Во время движения содержимое идёт за пальцем с сопротивлением (доля пути). */
const DRAG_FACTOR = 0.35;

/**
 * Свайп влево/вправо по содержимому дня — переключение «Вчера · Сегодня · Завтра» (UIX-FIT-10, UI-OWN-070): влево — вперёд, вправо — назад.
 * Вертикальная прокрутка не мешает (жест отказывает при вертикальном движении); на краях день не меняется, содержимое возвращается.
 * Что значит «соседний день» — в `swipedDay`.
 */
export function DaySwipe({ children }: Readonly<{ children: ReactNode }>) {
  const { day, today, setDay } = useClientDay();
  const shift = useSharedValue(0);
  const fade = useSharedValue(1);
  // Актуальные день и «сегодня» читаются из ref: быстрый второй свайп до перерисовки не должен брать устаревший день.
  const current = useRef({ day, today }); current.current = { day, today };
  const handle = useCallback((swipe: DaySwipeDirection) => {
    const next = swipedDay(current.current.day, current.current.today, swipe);
    if (next === null) { shift.value = withSpring(0, { damping: 24, stiffness: 340 }); return; }
    setDay(next);
    current.current = { day: next, today: current.current.today };
    shift.value = swipe === "NEXT" ? ENTER_SHIFT : -ENTER_SHIFT;
    fade.value = 0.35;
    shift.value = withTiming(0, { duration: 170 });
    fade.value = withTiming(1, { duration: 170 });
  }, [setDay, shift, fade]);
  const gesture = useMemo(() => Gesture.Pan().activeOffsetX([-24, 24]).failOffsetY([-14, 14])
    .onUpdate((event) => {
      "worklet";
      shift.value = event.translationX * DRAG_FACTOR;
    })
    .onEnd((event, success) => {
      "worklet";
      // Отменённый системой жест день не переключает.
      const swipe = success ? daySwipeOf(event.translationX, event.velocityX) : null;
      if (swipe === null) shift.value = withSpring(0, { damping: 24, stiffness: 340 });
      else scheduleOnRN(handle, swipe);
    })
    .onFinalize(() => {
      "worklet";
      if (shift.value !== 0 && fade.value === 1) shift.value = withSpring(0, { damping: 24, stiffness: 340 });
    }), [shift, fade, handle]);
  const moved = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: shift.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.fill, moved]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
