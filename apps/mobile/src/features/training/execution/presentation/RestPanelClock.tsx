import { memo, useEffect } from "react";
import { Text, TextInput, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedProps, useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";

export function restClockText(seconds: number): string {
  "worklet";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/** Все видимые часы читают один UI-clock; секундных React-обновлений нет. */
export const RestPanelClock = memo(function RestPanelClock({ timer, clock, finished, style, onElapsed, disabled }: Readonly<{
  timer: RestTimer; clock: SharedValue<number>; finished: boolean; style: StyleProp<TextStyle>; onElapsed: () => void; disabled: boolean;
}>) {
  const deadline = useSharedValue(timer.endAt);
  const paused = useSharedValue(timer.pausedLeftMs ?? -1);
  useEffect(() => { deadline.value = timer.endAt; paused.value = timer.pausedLeftMs ?? -1; }, [timer.endAt, timer.pausedLeftMs, deadline, paused]);
  useAnimatedReaction(() => paused.value < 0 ? Math.max(0, Math.ceil((deadline.value - clock.value) / 1000)) : -1,
    (left, before) => { if (left === 0 && before !== 0) scheduleOnRN(onElapsed); }, [onElapsed]);
  const props = useAnimatedProps(() => {
    const seconds = Math.max(0, Math.ceil((paused.value < 0 ? deadline.value - clock.value : paused.value) / 1000));
    const text = restClockText(seconds);
    return { text, defaultValue: text } as never;
  });
  if (finished) return <Text style={style} numberOfLines={2}>Отдых окончен</Text>;
  if (disabled) return <Text style={style}>{restClockText(remainingSec(timer, Date.now()))}</Text>;
  return <AnimatedInput editable={false} accessible={false} importantForAccessibility="no" caretHidden pointerEvents="none"
    underlineColorAndroid="transparent" defaultValue={restClockText(remainingSec(timer, Date.now()))} animatedProps={props}
    style={[{ padding: 0, margin: 0, borderWidth: 0, backgroundColor: "transparent" }, style]} />;
});
