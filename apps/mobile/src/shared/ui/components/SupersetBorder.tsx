import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const DASH = 10;
const PERIOD_MS = 900;

/**
 * Бегущая пунктирная рамка вокруг упражнений суперсета (как в 2.0): два пунктира цветов темы со сдвигом по кругу.
 * Анимация идёт на UI-потоке; при системной настройке «убрать анимацию» рамка статична.
 */
export function SupersetBorder({ radius, gap = 0, thickness = 3, children }: Readonly<{
  radius: number; gap?: number; thickness?: number; children: ReactNode;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [still, setStill] = useState(false);
  const offset = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) setStill(value); }, () => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => { alive = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    offset.value = 0;
    if (!still) offset.value = withRepeat(withTiming(DASH * 2, { duration: PERIOD_MS, easing: Easing.linear }), -1, false);
  }, [still, offset]);

  const primary = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const secondary = useAnimatedProps(() => ({ strokeDashoffset: offset.value + DASH }));

  const inset = thickness / 2;
  const width = Math.max(0, size.width - thickness);
  const height = Math.max(0, size.height - thickness);
  const corner = Math.max(0, radius - inset);
  const shape = { x: inset, y: inset, width, height, rx: corner, ry: corner, fill: "none", strokeWidth: thickness,
    strokeDasharray: `${DASH} ${DASH}`, strokeLinecap: "butt" } as const;

  return (
    <View collapsable={false} style={{ padding: thickness, gap }}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setSize((current) => current.width === w && current.height === h ? current : { width: w, height: h });
      }}>
      {children}
      {width > 0 && height > 0 ? (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
          {still ? <>
            <Rect {...shape} stroke={colors.accentInk} strokeDashoffset={0} />
            <Rect {...shape} stroke={colors.surface} strokeDashoffset={DASH} />
          </> : <>
            <AnimatedRect {...shape} stroke={colors.accentInk} animatedProps={primary} />
            <AnimatedRect {...shape} stroke={colors.surface} animatedProps={secondary} />
          </>}
        </Svg>
      ) : null}
    </View>
  );
}
