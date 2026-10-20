import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react-native";
import { DropdownMenu, EmptyState, FilterPill, InlineNotice, LoadingState, SelectionChip, StatusTag } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { mesocyclesWithHistory, scopeSummary, workoutGroups, type WorkoutGroup } from "./historyGroups.ts";
import { dateText, statusKinds, statusLabels } from "./historyFormat.ts";
import { durationText, plural, timeText } from "../../../../shared/format/clockText.ts";
import { programViewOf } from "./historyViewState.ts";
import { ALL_OPTION, type TrainingHistoryEntry } from "./trainingHistory.ts";
import { useClientHistory } from "./useClientHistory.ts";

/** Область «Все» в ключах прокрутки и раскрытых карточек. */
const ALL_SCOPE = "__all__";
/** С этого числа мезоциклов в ленте появляется кнопка со списком и поиском. */
const LIST_FROM = 10;

function OccurrenceRow({ entry, onOpen }: Readonly<{ entry: TrainingHistoryEntry; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const time = entry.startedAt === null ? null : `Начало ${timeText(entry.startedAt)}`;
  const duration = entry.durationSec === null ? null : durationText(entry.durationSec);
  const sets = `Рабочих подходов: ${entry.workingSets}`;
  return (
    <Pressable accessibilityRole="button" onPress={onOpen}
      accessibilityLabel={`Неделя ${entry.weekIndex}, ${dateText(entry.actualDate)}, ${statusLabels[entry.status]}. ${sets}. Открыть детали занятия`}
      style={({ pressed }) => [styles.occurrence, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
      <View style={styles.occurrenceHead}>
        <Text style={[styles.occurrenceTitle, { color: colors.textPrimary }]}>{`Неделя ${entry.weekIndex} · ${dateText(entry.actualDate)}`}</Text>
        <View style={styles.grow} />
        <StatusTag kind={statusKinds[entry.status]} label={statusLabels[entry.status]} />
        <ChevronRight size={18} color={colors.textMuted} />
      </View>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{[sets, time, duration].filter((part) => part !== null).join(" · ")}</Text>
    </Pressable>
  );
}

function GroupCard({ group, open, onToggle, onOpenExecution }: Readonly<{ group: WorkoutGroup; open: boolean; onToggle: () => void;
  onOpenExecution: (entry: TrainingHistoryEntry) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const count = group.occurrences.length;
  const summary = `${count} ${plural(count, "выполнение", "выполнения", "выполнений")} · проведено ${group.completed}`;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}
        accessibilityLabel={`${group.title}. ${summary}. ${open ? "Свернуть" : "Показать выполнения"}`} style={styles.cardHead}>
        <View style={styles.grow}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{group.title}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{summary}</Text>
        </View>
        {open ? <ChevronUp size={20} color={colors.textMuted} /> : <ChevronDown size={20} color={colors.textMuted} />}
      </Pressable>
      {open ? <View style={styles.occurrences}>
        {group.occurrences.map((entry) => <OccurrenceRow key={entry.key} entry={entry} onOpen={() => onOpenExecution(entry)} />)}
      </View> : null}
    </View>
  );
}

/**
 * Программа в «Истории занятий» (UX-контракт v1.2): у Расширенной — лента мезоцикла («Все» + мезоциклы с историей), ниже раскрываемые
 * карточки тренировок с выполнениями по неделям; у Простой и у программы с удалённым планом ленты нет. Выбор мезоцикла, раскрытые карточки и
 * позиция прокрутки хранятся, пока открыта карточка клиента (`programViewOf`). Экран только читает: выбранный план и дневник не меняются.
 */
export function HistoryProgramScreen({ clientId, programId, history, onOpenExecution, onTitle }: Readonly<{
  clientId: string;
  programId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  onOpenExecution: (entry: TrainingHistoryEntry) => void;
  /** Название программы — подзаголовок шапки (одна строка шапки, без «назад» в теле экрана). */
  onTitle: (title: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const view = programViewOf(clientId, programId);
  const { entries, failed } = useClientHistory(history, clientId);
  const [selected, setSelected] = useState<string | null | undefined>(view.mesocycleId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(view.expanded));
  const [listOpen, setListOpen] = useState(false);
  const listAnchor = useRef<View>(null);
  const listRef = useRef<FlatList<WorkoutGroup>>(null);

  const programEntries = useMemo(() => (entries ?? []).filter((entry) => entry.programId === programId), [entries, programId]);
  const options = useMemo(() => mesocyclesWithHistory(programEntries, programId), [programEntries, programId]);
  const first = programEntries[0];
  const programTitle = first === undefined ? undefined : first.planDeleted ? `${first.programTitle} (план удалён)` : first.programTitle;
  // Колбэк навигации может меняться на каждый рендер — шапку обновляем только при смене названия.
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;
  useEffect(() => { if (programTitle !== undefined) titleRef.current(programTitle); }, [programTitle]);

  // Выбор по умолчанию — мезоцикл с последним занятием; пропавший мезоцикл (удалён, нет занятий) заменяется тем же правилом.
  const latestMesocycle = programEntries.find((entry) => entry.mesocycleId !== null)?.mesocycleId ?? null;
  const known = selected === null || (selected !== undefined && options.some((option) => option.mesocycleId === selected));
  const scope: string | null = options.length === 0 ? null : known ? (selected as string | null) : latestMesocycle;
  const scopeKey = scope ?? ALL_SCOPE;
  const groups = useMemo(() => workoutGroups(programEntries, { programId, mesocycleId: scope }), [programEntries, programId, scope]);
  const summary = useMemo(() => scopeSummary(programEntries.filter((entry) => scope === null || entry.mesocycleId === scope)), [programEntries, scope]);

  const choose = useCallback((next: string | null) => { view.mesocycleId = next; setSelected(next); }, [view]);
  const toggle = useCallback((key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    view.expanded.clear();
    next.forEach((item) => view.expanded.add(item));
    return next;
  }), [view]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => { view.scroll.set(scopeKey, event.nativeEvent.contentOffset.y); }, [view, scopeKey]);
  // Возврат на область (или из «Деталей») — прежняя позиция списка тренировок.
  const loaded = entries !== null;
  useEffect(() => {
    const offset = view.scroll.get(scopeKey) ?? 0;
    if (offset <= 0 || !loaded) return undefined;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [view, scopeKey, loaded]);

  if (failed) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><View style={styles.pad}>
    <InlineNotice kind="error">Не удалось загрузить историю занятий.</InlineNotice></View></View>;
  if (entries === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><LoadingState label="Собираем историю…" /></View>;
  if (programEntries.length === 0) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <EmptyState reason="no-data" title="Записей программы нет" body="В этой программе нет занятий с подходами или исходом." /></View>;

  const mesocycleOptions = [{ value: ALL_OPTION, label: "Все" }, ...options.map((option) => ({ value: option.mesocycleId, label: option.title }))];
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Text style={[styles.summary, { color: colors.textSecondary }]}>
          {`Проведено ${summary.completed} · Записей ${summary.records} · Рабочих подходов ${summary.workingSets}`}</Text>
        {options.length > 0 ? <View style={styles.chipsRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.grow}>
            <SelectionChip group="Мезоцикл" label="Все" selected={scope === null} onPress={() => choose(null)} />
            {options.map((option) => <SelectionChip key={option.mesocycleId} group="Мезоцикл" label={option.title}
              selected={scope === option.mesocycleId} onPress={() => choose(option.mesocycleId)} />)}
          </ScrollView>
          {options.length >= LIST_FROM ? <FilterPill menu anchorRef={listAnchor} label="Список" expanded={listOpen}
            accessibilityLabel="Все мезоциклы списком" onPress={() => setListOpen(true)} /> : null}
        </View> : null}
      </View>
      <DropdownMenu visible={listOpen} anchor={listAnchor} title="Мезоцикл" options={mesocycleOptions} selected={scope ?? ALL_OPTION}
        searchable onClose={() => setListOpen(false)} onSelect={(value) => choose(value === ALL_OPTION ? null : value)} />
      <FlatList ref={listRef} data={groups as WorkoutGroup[]} keyExtractor={(group) => group.key} contentContainerStyle={styles.list}
        onScroll={onScroll} scrollEventThrottle={64}
        ListEmptyComponent={<EmptyState reason="no-data" title="В этом мезоцикле пока нет истории" body="Выберите другой мезоцикл или «Все»." />}
        renderItem={({ item }) => {
          const key = `${scopeKey}|${item.key}`;
          return <GroupCard group={item} open={expanded.has(key)} onToggle={() => toggle(key)} onOpenExecution={onOpenExecution} />;
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  summary: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  chipsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chips: { gap: 8, paddingRight: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  occurrences: { gap: 2 },
  occurrence: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, gap: 2, minHeight: 48, justifyContent: "center" },
  occurrenceHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  occurrenceTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
