import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Two independently adjustable handles; numeric fields can provide an additional precise input. */
export function PercentRangeSlider({ label, min, max, onChange }: Readonly<{ label: string; min: number; max: number; onChange: (min: number, max: number) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [width, setWidth] = useState(240);
  const latest = useRef({ min, max, width, onChange });
  latest.current = { min, max, width, onChange };
  const start = useRef(0);
  const responders = useMemo(() => (["min", "max"] as const).map((bound) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3,
    onPanResponderGrant: () => { start.current = latest.current[bound]; },
    onPanResponderMove: (_, gesture) => {
      const current = latest.current;
      const value = Math.round(start.current + gesture.dx * 100 / Math.max(1, current.width - 44));
      current.onChange(bound === "min" ? Math.max(0, Math.min(current.max, value)) : current.min,
        bound === "max" ? Math.min(100, Math.max(current.min, value)) : current.max);
    },
    onPanResponderTerminationRequest: () => false,
  })), []);
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.container}>
    <View style={[styles.track, { backgroundColor: colors.border }]} />
    <View style={[styles.track, { left: 22 + (width - 44) * min / 100, right: 22 + (width - 44) * (100 - max) / 100, backgroundColor: colors.accentFill }]} />
    {(["min", "max"] as const).map((bound, index) => <View key={bound} {...responders[index]!.panHandlers}
      accessible accessibilityRole="adjustable" accessibilityLabel={`${label}: ${bound === "min" ? "минимум" : "максимум"}`}
      accessibilityValue={{ min: 0, max: 100, now: bound === "min" ? min : max, text: `${bound === "min" ? min : max} %` }}
      accessibilityActions={[{ name: "increment", label: "Увеличить" }, { name: "decrement", label: "Уменьшить" }]}
      onAccessibilityAction={(event) => {
        const delta = event.nativeEvent.actionName === "increment" ? 1 : -1;
        onChange(bound === "min" ? Math.max(0, Math.min(max, min + delta)) : min, bound === "max" ? Math.min(100, Math.max(min, max + delta)) : max);
      }} style={[styles.hit, { left: (width - 44) * (bound === "min" ? min : max) / 100 }]}>
      <View style={[styles.thumb, { borderColor: colors.accentFill, backgroundColor: colors.surface }]} />
    </View>)}
  </View>;
}
const styles = StyleSheet.create({ container: { height: 48, width: "100%" }, track: { position: "absolute", left: 22, right: 22, top: 22, height: 4, borderRadius: 2 }, hit: { position: "absolute", top: 0, width: 44, height: 48, alignItems: "center", justifyContent: "center" }, thumb: { width: 24, height: 30, borderRadius: 10, borderWidth: 3 } });
