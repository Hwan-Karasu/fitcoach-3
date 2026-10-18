import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent,
  type NativeSyntheticEvent } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { AppButton } from "./AppButton.tsx";

const ITEM = 34;
const VISIBLE = 5;

/** Один барабан: прокрутка с привязкой к строке, выбранная строка — по центру. */
function Wheel({ values, index, onChange, label }: Readonly<{
  values: readonly string[]; index: number; onChange: (index: number) => void; label: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: index * ITEM, animated: false });
  }, [index, values.length]);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / ITEM)));
    if (next !== index) onChange(next);
  };
  return (
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: values[index] }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const next = index + (event.nativeEvent.actionName === "increment" ? 1 : -1);
        if (next >= 0 && next < values.length) onChange(next);
      }}
      style={styles.wheel}>
      <View pointerEvents="none" style={[styles.selection, { borderColor: colors.accentInk, backgroundColor: colors.surfaceRaised }]} />
      <ScrollView ref={scroll} showsVerticalScrollIndicator={false} snapToInterval={ITEM} decelerationRate="fast"
        nestedScrollEnabled onMomentumScrollEnd={settle} onScrollEndDrag={(event) => {
          // Без инерции onMomentumScrollEnd может не прийти — досчитываем по месту отпускания.
          if (Math.abs(event.nativeEvent.velocity?.y ?? 0) < 0.05) settle(event);
        }}
        contentContainerStyle={{ paddingVertical: ITEM * Math.floor(VISIBLE / 2) }}>
        {values.map((value, at) => (
          <Pressable key={value} onPress={() => { onChange(at); scroll.current?.scrollTo({ y: at * ITEM, animated: true }); }}
            style={styles.item}>
            <Text style={[styles.value, { color: at === index ? colors.textPrimary : colors.textMuted,
              fontFamily: at === index ? fonts.semibold : fonts.regular }]}>{value}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Барабан времени «часы : минуты» с шагом 30 минут (сетка календаря), во всплывающем окне.
 * Значение — минуты от начала суток; `min`/`max` ограничивают выбор включительно, 24:00 допустимо как max.
 */
export function TimeWheelPicker({ visible, title, value, min, max, onConfirm, onClose }: Readonly<{
  visible: boolean;
  title: string;
  value: number;
  min: number;
  max: number;
  onConfirm: (minute: number) => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [hour, setHour] = useState(Math.floor(value / 60));
  const [half, setHalf] = useState(value % 60 >= 30 ? 1 : 0);
  useEffect(() => {
    if (!visible) return;
    setHour(Math.floor(value / 60));
    setHalf(value % 60 >= 30 ? 1 : 0);
  }, [value, visible]);
  const hours: number[] = [];
  for (let at = Math.floor(min / 60); at <= Math.floor(max / 60); at += 1) hours.push(at);
  const minutes = hour === 24 ? ["00"] : ["00", "30"];
  const chosen = Math.max(min, Math.min(max, hour * 60 + (hour === 24 ? 0 : half * 30)));
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <View style={styles.wheels}>
            <Wheel label="Часы" values={hours.map(pad)} index={Math.max(0, hours.indexOf(hour))}
              onChange={(at) => setHour(hours[at] ?? hour)} />
            <Text style={[styles.colon, { color: colors.textPrimary }]}>:</Text>
            <Wheel label="Минуты" values={minutes} index={hour === 24 ? 0 : half} onChange={setHalf} />
          </View>
          <View style={styles.actions}>
            <View style={styles.action}><AppButton compact variant="secondary" label="Отмена" onPress={onClose} /></View>
            <View style={styles.action}><AppButton compact label="Готово" onPress={() => { onConfirm(chosen); onClose(); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const SECOND_STEP = 5;

/**
 * Барабан длительности «минуты : секунды» (секунды с шагом 5) во всплывающем окне; значение — секунды,
 * `min`/`max` включительно. `clearLabel` добавляет действие «выключить» (например, таймер без отдыха).
 */
export function DurationWheelPicker({ visible, title, value, min, max, clearLabel, onConfirm, onClear, onClose }: Readonly<{
  visible: boolean;
  title: string;
  value: number;
  min: number;
  max: number;
  clearLabel?: string;
  onConfirm: (seconds: number) => void;
  onClear?: () => void;
  onClose: () => void;
}>) {
  const [minute, setMinute] = useState(Math.floor(value / 60));
  const [second, setSecond] = useState(Math.round((value % 60) / SECOND_STEP));
  useEffect(() => {
    if (!visible) return;
    setMinute(Math.floor(value / 60));
    setSecond(Math.round((value % 60) / SECOND_STEP));
  }, [value, visible]);
  const minutes: number[] = [];
  for (let at = Math.floor(min / 60); at <= Math.floor(max / 60); at += 1) minutes.push(at);
  const seconds = Array.from({ length: 60 / SECOND_STEP }, (_, at) => pad(at * SECOND_STEP));
  const chosen = Math.max(min, Math.min(max, minute * 60 + second * SECOND_STEP));
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <View style={styles.wheels}>
            <Wheel label="Минуты" values={minutes.map(pad)} index={Math.max(0, minutes.indexOf(minute))}
              onChange={(at) => setMinute(minutes[at] ?? minute)} />
            <Text style={[styles.colon, { color: colors.textPrimary }]}>:</Text>
            <Wheel label="Секунды" values={seconds} index={second} onChange={setSecond} />
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Будет: ${Math.floor(chosen / 60)}:${pad(chosen % 60)}`}</Text>
          <View style={styles.actions}>
            <View style={styles.action}><AppButton compact variant="secondary" label="Отмена" onPress={onClose} /></View>
            <View style={styles.action}><AppButton compact label="Готово" onPress={() => { onConfirm(chosen); onClose(); }} /></View>
          </View>
          {clearLabel !== undefined && onClear !== undefined ? (
            <AppButton compact variant="ghost" label={clearLabel} onPress={() => { onClear(); onClose(); }} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  scrim: { backgroundColor: "rgba(0,0,0,0.45)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: 236, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, textAlign: "center" },
  wheels: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  wheel: { width: 64, height: ITEM * VISIBLE },
  selection: { position: "absolute", left: 0, right: 0, top: ITEM * Math.floor(VISIBLE / 2), height: ITEM, borderWidth: 1, borderRadius: 8 },
  item: { height: ITEM, alignItems: "center", justifyContent: "center" },
  value: { fontSize: 18, lineHeight: 23 },
  colon: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1 },
});
