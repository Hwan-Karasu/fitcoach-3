import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, DateRangeCalendar, FilterPill, SegmentedControl, type DateRange } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { periods, type CustomRange, type PeriodId } from "./statsFilters.ts";
import { rangeLabel } from "./statsParts.tsx";

export interface PeriodValue {
  readonly period: PeriodId;
  readonly custom: CustomRange | null;
}

/** Подпись выбранного периода: готовый («3 мес») или свои даты («12 сен – 20 окт 2026»). */
export function periodLabel(value: PeriodValue): string {
  if (value.period === "custom") return value.custom === null ? "Свой период" : rangeLabel(value.custom.from, value.custom.to);
  return periods.find((item) => item.id === value.period)?.label ?? "Период";
}

/**
 * Пилюля «Период ▾» → окно снизу: готовые периоды сеткой (нажатие применяет сразу) и календарь диапазона для своего
 * (первое нажатие — начало, второе — конец; «Применить»). Не растёт с числом вариантов и не прокручивается вбок.
 */
export function PeriodPill({ value, onChange, today, grow = false }: Readonly<{
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
  /** Сегодняшняя локальная дата `YYYY-MM-DD` — последний доступный день. */
  today: string;
  grow?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ from: null, to: null });
  const label = periodLabel(value);
  const ready = draft.from !== null && draft.to !== null;
  const show = () => {
    setDraft(value.period === "custom" && value.custom !== null ? value.custom : { from: null, to: null });
    setOpen(true);
  };
  const apply = () => {
    if (draft.from === null || draft.to === null) return;
    const [from, to] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    onChange({ period: "custom", custom: { from, to } });
    setOpen(false);
  };
  return <>
    <FilterPill label={label} accessibilityLabel={`Период: ${label}`} menu expanded={open} grow={grow} onPress={show} />
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть выбор периода" style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.canvas }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Период</Text>
          {/* Готовые периоды — один ряд; при своих датах ни один сегмент не выбран. */}
          <SegmentedControl compact fit items={periods.map((item) => ({ id: item.id as PeriodId, label: item.label }))} selectedId={value.period}
            onSelect={(id) => { if (id !== "custom") { onChange({ period: id, custom: value.custom }); setOpen(false); } }} />
          <Text style={[styles.subtitle, { color: colors.textPrimary }]}>Свой период</Text>
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            {draft.from === null ? "Нажмите на первый день" : draft.to === null ? "Теперь нажмите на последний день"
              : rangeLabel(draft.from <= draft.to ? draft.from : draft.to, draft.from <= draft.to ? draft.to : draft.from)}</Text>
          <ScrollView style={styles.calendar} contentContainerStyle={styles.calendarContent}>
            <DateRangeCalendar value={draft} max={today} onChange={setDraft} />
          </ScrollView>
          <AppButton label="Применить" disabled={!ready} onPress={apply} />
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 4 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  calendar: { flexGrow: 0 },
  calendarContent: { paddingBottom: 4 },
});
