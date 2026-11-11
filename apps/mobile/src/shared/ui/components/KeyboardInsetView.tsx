import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { AppState, Keyboard, findNodeHandle, type LayoutChangeEvent, type StyleProp, type View, type ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { KeyboardControllerNative, useKeyboardHandler, useReanimatedKeyboardAnimation, useWindowDimensions } from "react-native-keyboard-controller";
import { forcedClosedAfter, keyboardInset } from "./keyboardInsetRules.ts";

/**
 * Контейнер, уступающий место клавиатуре нижним отступом: замена `KeyboardAvoidingView` из keyboard-controller
 * (`automaticOffset behavior="padding"`) с теми же событиями и той же формулой. Отличие одно: отступ всегда задаётся явно и
 * обнуляется, когда React Native сообщает, что клавиатуры нет, — у библиотечного он «залипал» (см. `keyboardInsetRules.ts`).
 * Выключать библиотечный контейнер пропом `enabled` бесполезно: его стиль тогда не содержит `paddingBottom`, а Reanimated
 * отправляет только присутствующие свойства, и прежнее значение остаётся.
 */
export function KeyboardInsetView({ children, style }: Readonly<{ children: ReactNode; style?: StyleProp<ViewStyle> }>) {
  const container = useRef<View | null>(null);
  const { height: screenHeight } = useWindowDimensions();
  const library = useReanimatedKeyboardAnimation();
  const frameBottom = useSharedValue(0);
  const keyboardHeight = useSharedValue(0);
  const progress = useSharedValue(0);
  // До первого события показа клавиатуры отступа нет: состояние библиотеки к моменту монтирования могло уже застрять.
  const forcedClosed = useSharedValue(!Keyboard.isVisible());

  useLayoutEffect(() => {
    keyboardHeight.value = -library.height.value;
    progress.value = library.progress.value;
  }, [keyboardHeight, library, progress]);

  useKeyboardHandler({
    onStart: (event) => {
      "worklet";
      if (event.height > 0) keyboardHeight.value = event.height;
      forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "KEYBOARD", height: event.height });
    },
    onMove: (event) => {
      "worklet";
      progress.value = event.progress;
      forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "KEYBOARD", height: event.height });
    },
    onInteractive: (event) => {
      "worklet";
      progress.value = event.progress;
      forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "KEYBOARD", height: event.height });
    },
    onEnd: (event) => {
      "worklet";
      progress.value = event.progress;
      forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "KEYBOARD", height: event.height });
    },
  }, []);

  useEffect(() => {
    const close = () => { forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "HIDDEN" }); };
    const hidden = Keyboard.addListener("keyboardDidHide", close);
    const shown = Keyboard.addListener("keyboardDidShow", () => { forcedClosed.value = forcedClosedAfter(forcedClosed.value, { kind: "SHOWN" }); });
    // Клавиатура, закрытая системой, пока приложение было свёрнуто, события скрытия может не дать вовсе.
    const resumed = AppState.addEventListener("change", (state) => { if (state === "active" && !Keyboard.isVisible()) close(); });
    return () => { hidden.remove(); shown.remove(); resumed.remove(); };
  }, [forcedClosed]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const tag = findNodeHandle(container.current);
    if (tag === null) { frameBottom.value = y + height; return; }
    // Положение в окне, а не в родителе: над контейнером может быть шапка экрана.
    KeyboardControllerNative.viewPositionInWindow(tag)
      .then((position) => { frameBottom.value = position.y + height; }, () => { frameBottom.value = y + height; });
  }, [frameBottom]);

  const inset = useAnimatedStyle(() => ({
    paddingBottom: keyboardInset(frameBottom.value, screenHeight, keyboardHeight.value, progress.value, forcedClosed.value),
  }), [screenHeight]);

  return <Reanimated.View ref={container} style={[style, inset]} onLayout={onLayout}>{children}</Reanimated.View>;
}
