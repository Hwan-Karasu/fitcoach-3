import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent,
  type NativeSyntheticEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { TimerPicker } from "react-native-timer-picker";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { AppButton } from "./AppButton.tsx";

const ITEM = 34;
const VISIBLE = 5;

/**
 * Кольцевой барабан библиотеки — FlatList с данными ×3 и окном в 5 строк: у края он без анимации прыгает на ±60 строк,
 * а ячейки там ещё не созданы, и колонка на миг пустая. Список короткий (~180 строк текста), поэтому ячейки создаются сразу.
 */
const FullWheelList = forwardRef<FlatList, React.ComponentProps<typeof FlatList>>(function FullWheelList(props, ref) {
  const count = Math.max(1, props.data?.length ?? 1);
  return <FlatList {...props} ref={ref} initialNumToRender={count} maxToRenderPerBatch={count} windowSize={count}
    removeClippedSubviews={false} />;
});

const feedback = () => { Haptics.selectionAsync().catch(() => undefined); };

/** Стили барабана библиотеки: один объект на тему, а не новый на каждый рендер (иначе каждый выбор перерисовывает обе колонки). */
function useWheelStyles() {
  const colors = usePrototypeTheme().palette.tokens;
  return useMemo(() => ({
    backgroundColor: colors.surface,
    pickerItem: { fontFamily: fonts.medium, fontSize: 18, color: colors.textMuted },
    selectedPickerItem: { fontFamily: fonts.semibold, color: colors.textPrimary },
    pickerLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary },
    pickerItemContainer: { height: 44 },
    pickerContainer: { backgroundColor: colors.surface },
  }), [colors]);
}

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
 * Барабан времени «часы : минуты» во всплывающем окне; по умолчанию шаг 30 минут (сетка календаря), `minuteStep = 1` — точное время
 * (отметки начала и окончания тренировки). Значение — минуты от начала суток; `min`/`max` ограничивают выбор включительно, 24:00 допустимо как max.
 * `onClear` + `clearLabel` — действие «убрать значение».
 */
export function TimeWheelPicker({ visible, title, value, min, max, minuteStep = 30, clearLabel, onConfirm, onClear, onClose }: Readonly<{
  visible: boolean;
  title: string;
  value: number;
  min: number;
  max: number;
  minuteStep?: number;
  clearLabel?: string;
  onConfirm: (minute: number) => void;
  onClear?: () => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [hour, setHour] = useState(Math.floor(value / 60));
  const slots = Array.from({ length: Math.floor(60 / minuteStep) }, (_, at) => at * minuteStep);
  const [half, setHalf] = useState(Math.floor((value % 60) / minuteStep));
  useEffect(() => {
    if (!visible) return;
    setHour(Math.floor(value / 60));
    setHalf(Math.floor((value % 60) / minuteStep));
  }, [value, visible, minuteStep]);
  const hours: number[] = [];
  for (let at = Math.floor(min / 60); at <= Math.floor(max / 60); at += 1) hours.push(at);
  const minutes = hour === 24 ? ["00"] : slots.map(pad);
  const chosen = Math.max(min, Math.min(max, hour * 60 + (hour === 24 ? 0 : (slots[half] ?? 0))));
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
          {onClear !== undefined && clearLabel !== undefined
            ? <AppButton compact variant="secondary" label={clearLabel} onPress={() => { onClear(); onClose(); }} /> : null}
          <View style={styles.actions}>
            <View style={styles.action}><AppButton compact variant="secondary" label="Отмена" onPress={onClose} /></View>
            <View style={styles.action}><AppButton compact label="Готово" onPress={() => { onConfirm(chosen); onClose(); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Барабан длительности «минуты : секунды» во всплывающем окне — кольцевой, листается в обе стороны
 * (react-native-timer-picker, ADR-004): за 59 идёт 00 и наоборот. Значение — секунды, `min`/`max` включительно
 * (выбор вне границ подтягивается к ним, итог показан строкой «Будет»). `clearLabel` — действие «выключить».
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
  const [second, setSecond] = useState(value % 60);
  useEffect(() => {
    if (!visible) return;
    setMinute(Math.floor(value / 60));
    setSecond(value % 60);
  }, [value, visible]);
  const chosen = Math.max(min, Math.min(max, minute * 60 + second));
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const wheelStyles = useWheelStyles();
  const onDuration = useCallback((duration: { minutes: number; seconds: number }) => { setMinute(duration.minutes); setSecond(duration.seconds); }, []);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <TimerPicker hideDays hideHours padMinutesWithZero padSecondsWithZero padWithNItems={2}
            maximumMinutes={Math.floor(max / 60)} maximumSeconds={59} minuteLabel="мин" secondLabel="с"
            initialValue={{ minutes: Math.floor(value / 60), seconds: value % 60 }}
            onDurationChange={onDuration}
            pickerFeedback={feedback} styles={wheelStyles} FlatList={FullWheelList} />
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

/**
 * Барабаны «часы : минуты» для интервала (напоминание «за N до начала», §41.4): значение — минуты, `min`/`max` включительно;
 * выбор вне границ подтягивается к ним, итог показан строкой «Будет».
 */
export function HourMinutePicker({ visible, title, value, min, max, onConfirm, onClose }: Readonly<{
  visible: boolean; title: string; value: number; min: number; max: number; onConfirm: (minutes: number) => void; onClose: () => void;
}>) {
  const [hour, setHour] = useState(Math.floor(value / 60));
  const [minute, setMinute] = useState(value % 60);
  useEffect(() => {
    if (!visible) return;
    setHour(Math.floor(value / 60));
    setMinute(value % 60);
  }, [value, visible]);
  const chosen = Math.max(min, Math.min(max, hour * 60 + minute));
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const wheelStyles = useWheelStyles();
  const onDuration = useCallback((duration: { hours: number; minutes: number }) => { setHour(duration.hours); setMinute(duration.minutes); }, []);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <TimerPicker hideDays hideSeconds padHoursWithZero padMinutesWithZero padWithNItems={2}
            maximumHours={Math.floor(max / 60)} maximumMinutes={59} hourLabel="ч" minuteLabel="мин"
            initialValue={{ hours: Math.floor(value / 60), minutes: value % 60 }}
            onDurationChange={onDuration}
            pickerFeedback={feedback} styles={wheelStyles} FlatList={FullWheelList} />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Будет: ${Math.floor(chosen / 60)} ч ${chosen % 60} мин`}</Text>
          <View style={styles.actions}>
            <View style={styles.action}><AppButton compact variant="secondary" label="Отмена" onPress={onClose} /></View>
            <View style={styles.action}><AppButton compact label="Готово" onPress={() => { onConfirm(chosen); onClose(); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center" },
  scrim: { backgroundColor: "rgba(0,0,0,0.45)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { minWidth: 260, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, alignItems: "stretch" },
  title: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, textAlign: "center" },
  wheels: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  wheel: { width: 64, height: ITEM * VISIBLE },
  selection: { position: "absolute", left: 0, right: 0, top: ITEM * Math.floor(VISIBLE / 2), height: ITEM, borderWidth: 1, borderRadius: 8 },
  item: { height: ITEM, alignItems: "center", justifyContent: "center" },
  value: { fontSize: 16, lineHeight: 21 },
  colon: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1 },
});
