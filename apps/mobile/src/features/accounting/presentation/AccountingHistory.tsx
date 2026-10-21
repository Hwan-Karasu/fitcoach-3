import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banknote, ChevronDown, ChevronLeft, ChevronRight, History, Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react-native";
import { DropdownMenu, SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { withAlpha } from "../../../shared/ui/theme/colorAlpha.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ClientAccountingSnapshot, LedgerEntryType } from "../domain/AccountingModel.ts";
import { formatKopeks } from "../domain/AccountingRules.ts";
import { accountingHistoryDate, shiftAccountingMonth } from "./accountingHistoryPeriod.ts";

type Filter = "ALL" | "CREDITS" | "PAYMENTS";
interface HistoryRow {
  readonly key: string;
  readonly at: string;
  readonly date: string;
  readonly kind: LedgerEntryType | "PAYMENT";
  readonly title: string;
  readonly detail: string;
  readonly note: string | null;
  readonly value: string;
  readonly unit: string | null;
  readonly positive: boolean;
}
const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const filters = [{ id: "ALL", label: "Все" }, { id: "CREDITS", label: "Занятия" }, { id: "PAYMENTS", label: "Оплаты" }] as const;
const titles: Readonly<Record<LedgerEntryType, string>> = { ISSUED: "Пакет начислен", USED: "Занятие списано", RETURNED: "Занятие возвращено", ADJUSTMENT: "Корректировка" };
const methods = { transfer: "Перевод", cash: "Наличные", other: "Другое" } as const;
const units = (count: number) => count % 100 >= 11 && count % 100 <= 14 ? "занятий" : count % 10 === 1 ? "занятие" : count % 10 >= 2 && count % 10 <= 4 ? "занятия" : "занятий";
const dateLabel = (at: string) => new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Только представление сохранённых операций: оплаты и кредиты не складываются в общий баланс. */
export function AccountingHistory({ snapshot }: Readonly<{ snapshot: ClientAccountingSnapshot }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [menu, setMenu] = useState<"YEAR" | "MONTH" | null>(null);
  const yearAnchor = useRef<View>(null);
  const monthAnchor = useRef<View>(null);
  const list = useRef<ScrollView>(null);
  const rows = useMemo<readonly HistoryRow[]>(() => {
    const packTitle = (id: string | null) => id === null ? "Без пакета" : snapshot.packs.find(({ pack }) => pack.id === id)?.pack.title ?? "Пакет занятий";
    return [
      ...snapshot.ledger.map((row): HistoryRow => ({ key: `credit:${row.id}`, at: row.createdAt, date: accountingHistoryDate(row.createdAt), kind: row.entryType,
        title: titles[row.entryType], detail: packTitle(row.packId), note: row.reason,
        value: `${row.delta < 0 ? "−" : row.delta > 0 ? "+" : ""}${Math.abs(row.delta)}`, unit: units(Math.abs(row.delta)), positive: row.delta > 0 })),
      ...snapshot.payments.map((row): HistoryRow => ({ key: `payment:${row.id}`, at: row.createdAt, date: accountingHistoryDate(row.createdAt, row.paidOn), kind: "PAYMENT", title: "Оплата получена",
        detail: `${methods[row.method]} · ${packTitle(row.packId)}`, note: [`Дата оплаты: ${row.paidOn.split("-").reverse().join(".")}`, row.note].filter(Boolean).join("\n"),
        value: `+${formatKopeks(row.amountKopeks)}`, unit: null, positive: true })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  }, [snapshot]);
  const activeMonth = selectedMonth ?? rows[0]?.date.slice(0, 7) ?? accountingHistoryDate(new Date().toISOString()).slice(0, 7);
  const [year, month] = activeMonth.split("-") as [string, string];
  const years = [...new Set([String(new Date().getFullYear()), year, ...rows.map((row) => row.date.slice(0, 4))])].sort((a, b) => b.localeCompare(a));
  useEffect(() => { list.current?.scrollTo({ y: 0, animated: false }); }, [activeMonth, filter]);
  const groups = useMemo(() => {
    const grouped = new Map<string, { title: string; rows: HistoryRow[] }>();
    for (const row of rows) {
      if (filter === "PAYMENTS" && row.kind !== "PAYMENT" || filter === "CREDITS" && row.kind === "PAYMENT") continue;
      const key = row.date.slice(0, 7);
      if (key !== activeMonth) continue;
      const group = grouped.get(key) ?? { title: `${months[Number(month) - 1]} ${year}`, rows: [] };
      group.rows.push(row);
      grouped.set(key, group);
    }
    return [...grouped.entries()];
  }, [rows, filter, activeMonth, month, year]);
  const visibleCount = groups.reduce((sum, [, group]) => sum + group.rows.length, 0);

  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>История абонемента и оплаты</Text>
      <View style={[styles.count, { backgroundColor: colors.accentSoft }]}>
        <Text accessibilityLabel={`Операций за выбранный месяц: ${visibleCount}`} style={[styles.countLabel, { color: colors.accentInk }]}>{visibleCount}</Text>
      </View>
    </View>
    {rows.length > 0 ? <SegmentedControl compact items={filters} selectedId={filter} onSelect={setFilter} /> : null}
    <View style={styles.periodNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий месяц" onPress={() => setSelectedMonth(shiftAccountingMonth(activeMonth, -1))} style={styles.periodArrow}>
        <ChevronLeft size={20} color={colors.accentInk} />
      </Pressable>
      <View ref={monthAnchor} collapsable={false} style={styles.monthSelect}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Выбрать месяц: ${months[Number(month) - 1]}`} onPress={() => setMenu("MONTH")}
          style={[styles.periodSelect, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.periodLabel, { color: colors.textPrimary }]}>{months[Number(month) - 1]}</Text>
          <ChevronDown size={14} color={colors.accentInk} />
        </Pressable>
      </View>
      <View ref={yearAnchor} collapsable={false} style={styles.yearSelect}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Выбрать год: ${year}`} onPress={() => setMenu("YEAR")}
          style={[styles.periodSelect, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.periodLabel, { color: colors.textPrimary }]}>{year}</Text>
          <ChevronDown size={14} color={colors.accentInk} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Следующий месяц" onPress={() => setSelectedMonth(shiftAccountingMonth(activeMonth, 1))} style={styles.periodArrow}>
        <ChevronRight size={20} color={colors.accentInk} />
      </Pressable>
    </View>
    <DropdownMenu visible={menu === "MONTH"} anchor={monthAnchor} title="Месяц" selected={String(Number(month))}
      options={months.map((label, index) => ({ value: String(index + 1), label }))} onClose={() => setMenu(null)}
      onSelect={(value) => setSelectedMonth(`${year}-${value.padStart(2, "0")}`)} />
    <DropdownMenu visible={menu === "YEAR"} anchor={yearAnchor} title="Год" selected={year}
      options={years.map((value) => ({ value, label: value }))} onClose={() => setMenu(null)}
      onSelect={(value) => setSelectedMonth(`${value}-${month}`)} />
    <ScrollView ref={list} nestedScrollEnabled persistentScrollbar showsVerticalScrollIndicator
      style={styles.viewport} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
    {groups.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <History size={26} color={colors.textMuted} />
      <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{rows.length === 0 ? "История пока пуста" : "За этот месяц операций нет"}</Text>
      <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>Здесь появятся начисления занятий, списания и оплаты.</Text>
    </View> : null}
    {groups.map(([key, group]) => <View key={key} style={styles.group}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {group.rows.map((row, index) => {
          const ink = row.positive ? colors.success : row.kind === "ADJUSTMENT" ? colors.textSecondary : colors.warning;
          const Icon = row.kind === "PAYMENT" ? Banknote : row.kind === "ISSUED" ? Plus : row.kind === "RETURNED" ? RotateCcw : row.kind === "ADJUSTMENT" ? SlidersHorizontal : Minus;
          return <View key={row.key} accessible style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
            <View style={[styles.icon, { backgroundColor: withAlpha(ink, 0.1) }]}><Icon size={16} strokeWidth={2} color={ink} /></View>
            <View style={styles.content}>
              <View style={styles.rowHeading}>
                <Text style={[styles.rowTitle, styles.grow, { color: colors.textPrimary }]}>{row.title}</Text>
                <View style={styles.amount}>
                  <Text style={[styles.value, { color: ink }]}>{row.value}</Text>
                  {row.unit !== null ? <Text style={[styles.unit, { color: colors.textSecondary }]}>{row.unit}</Text> : null}
                </View>
              </View>
              <View style={styles.metadata}>
                <Text numberOfLines={1} style={[styles.detail, styles.grow, { color: colors.textSecondary }]}>{row.detail}</Text>
                <Text style={[styles.date, { color: colors.textMuted }]}>{dateLabel(row.at)}</Text>
              </View>
              {row.note !== null ? <Text style={[styles.note, { color: colors.textSecondary }]}>{row.note}</Text> : null}
            </View>
          </View>;
        })}
      </View>
    </View>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  viewport: { height: 320, flexGrow: 0 },
  listContent: { gap: 10, paddingRight: 5, paddingBottom: 4 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 17, lineHeight: 23 },
  count: { minWidth: 30, minHeight: 28, borderRadius: 10, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  countLabel: { fontFamily: fonts.bold, fontSize: 12 },
  group: { gap: 6 },
  periodNav: { flexDirection: "row", alignItems: "center", gap: 6 },
  periodArrow: { width: 38, minHeight: 44, alignItems: "center", justifyContent: "center" },
  monthSelect: { flex: 1, minWidth: 0 },
  yearSelect: { width: 90 },
  periodSelect: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8 },
  periodLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 10, paddingVertical: 9 },
  icon: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minWidth: 0, gap: 3 },
  rowHeading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  grow: { flex: 1 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  amount: { flexDirection: "row", alignItems: "baseline", gap: 4, maxWidth: "55%", flexShrink: 1 },
  value: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, fontVariant: ["tabular-nums"], flexShrink: 1 },
  unit: { fontFamily: fonts.regular, fontSize: 9, lineHeight: 13 },
  metadata: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  detail: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  note: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  date: { fontFamily: fonts.regular, fontSize: 9, lineHeight: 14 },
  empty: { alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 18, padding: 24 },
  emptyHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "center" },
});
