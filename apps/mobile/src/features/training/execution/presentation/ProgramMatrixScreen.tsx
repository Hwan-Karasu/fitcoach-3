import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withDecay, type SharedValue } from "react-native-reanimated";
import { InlineNotice, LoadingState, SearchableSelect, SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { useExerciseLookup, weekTypeLabels, weekTypeTone, type ExerciseLookupPort, type Mesocycle, type TrainingPlansRepositoryPort,
  type TrainingProgram } from "../../plans/public.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { diaryFields, compactWithDrops, planText } from "./setFormat.ts";
import { buildProgramMatrix, type MatrixCell, type MatrixWeek, type ProgramMatrix } from "./programMatrix.ts";

const LABEL_WIDTH = 136;
const CELL_WIDTH = 132;
const SIDE_PADDING = 16;

/** Версия структуры для выбора в матрице: действующая или историческая с периодом действия (§48.5.4, §48.9). */
interface MatrixVersion {
  readonly id: string;
  readonly label: string;
  readonly current: boolean;
  readonly weeks: readonly MatrixWeek[];
}

const dateOf = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
};
const timeOf = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** «Текущая · с 15.03.2026», «01.02.2026–15.03.2026»; в один день — со временем (§48.5.4). */
function versionLabel(validFrom: string, validTo: string | null): string {
  if (validTo === null) return `Текущая · с ${dateOf(validFrom)}`;
  return dateOf(validFrom) === dateOf(validTo) ? `${dateOf(validFrom)} ${timeOf(validFrom)}–${timeOf(validTo)}`
    : `${dateOf(validFrom)}–${dateOf(validTo)}`;
}

type Item =
  | Readonly<{ kind: "section"; key: string; title: string }>
  | Readonly<{ kind: "row"; key: string; name: string; cells: ReadonlyMap<number, MatrixCell> }>
  | Readonly<{ kind: "total"; key: string }>;

/** Правая часть строки: ячейки недель, сдвинутые общей горизонтальной прокруткой. */
function Shifted({ offset, width, children }: Readonly<{ offset: SharedValue<number>; width: number; children: React.ReactNode }>) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -offset.value }] }));
  return <View style={[styles.window, { width }]}><Animated.View style={[styles.track, style]}>{children}</Animated.View></View>;
}

const CellView = memo(function CellView({ cell, onOpen }: Readonly<{ cell: MatrixCell | undefined; onOpen: (() => void) | null }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  if (cell === undefined) {
    return <View style={[styles.cell, { borderColor: colors.border }]}><Text style={[styles.dash, { color: colors.textMuted }]}>—</Text></View>;
  }
  const content = <>
    {cell.sets.map((set, index) => (
      <Text key={index} numberOfLines={1} style={[styles.set, { color: colors.textSecondary }]}>
        {`${set.label}. ${set.plan} · `}
        <Text style={{ color: set.done ? colors.success : set.fact === null ? colors.textMuted : colors.textPrimary }}>{set.fact ?? "—"}</Text>
      </Text>
    ))}
  </>;
  return onOpen === null
    ? <View style={[styles.cell, { borderColor: colors.border }]}>{content}</View>
    : <Pressable accessibilityRole="button" accessibilityLabel="Открыть дневник этой тренировки" onPress={onOpen}
      style={({ pressed }) => [styles.cell, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
      {content}
    </Pressable>;
});

/**
 * Матрица недель (T05): строки — упражнения по тренировкам, колонки — недели; названия слева и недели сверху
 * закреплены, прокрутка по двум осям. Выбор версии — только здесь и только для просмотра (§48.5.4); переход в
 * дневник — из действующей версии. Позиция прокрутки запоминается по мезоциклу и версии.
 */
export function ProgramMatrixScreen({ clientId, programId, plans, execution, exercises, onOpenWorkout }: Readonly<{
  clientId: string;
  programId: string;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  exercises: ExerciseLookupPort;
  onOpenWorkout: (weekIndex: number, workoutId: string, mesocycleId: string | null) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const { width: screenWidth } = useWindowDimensions();
  const [program, setProgram] = useState<TrainingProgram | null>(null);
  const [mesocycles, setMesocycles] = useState<readonly Mesocycle[]>([]);
  const [mesocycleId, setMesocycleId] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly MatrixVersion[] | null>(null);
  const [versionId, setVersionId] = useState("current");
  const [executions, setExecutions] = useState<Awaited<ReturnType<TrainingExecutionPort["listProgramExecutions"]>>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  // Программа и мезоциклы.
  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await plans.getProgram(clientId, programId);
      if (!active || loaded === null) { if (active) setMessage("Программа не найдена."); return; }
      setProgram(loaded);
      if (loaded.kind === "PERIODIZED") {
        const plan = await plans.getPeriodizedPlan(clientId, programId);
        if (!active || plan === null) return;
        setMesocycles(plan.mesocycles);
        setMesocycleId((current) => current ?? plan.selectedMesocycleId ?? plan.mesocycles[0]?.id ?? null);
      }
    })().catch(() => { if (active) setMessage("Не удалось открыть программу."); });
    return () => { active = false; };
  }, [clientId, plans, programId, revision]);

  // Версии структуры выбранного мезоцикла (или Простой программы) и выполнения.
  useEffect(() => {
    let active = true;
    if (program === null || (program.kind === "PERIODIZED" && mesocycleId === null)) return undefined;
    void (async () => {
      const [loadedVersions, loadedExecutions] = await Promise.all([
        program.kind === "SIMPLE"
          ? plans.getSimpleVersions(clientId, programId).then((items) => items.map((item) => ({ id: item.id,
            label: versionLabel(item.validFrom, item.validTo), current: item.validTo === null,
            weeks: item.weeks.map((week) => ({ index: week.index, caption: null, workouts: week.workouts })) })))
          : plans.getMesocycleVersions(clientId, programId, mesocycleId ?? "").then((items) => items.map((item) => ({ id: item.id,
            label: versionLabel(item.validFrom, item.validTo), current: item.validTo === null,
            weeks: item.structure.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type], type: week.type, workouts: week.workouts })) }))),
        execution.listProgramExecutions(clientId, programId),
      ]);
      if (!active) return;
      setVersions(loadedVersions);
      setExecutions(loadedExecutions);
      setVersionId((current) => loadedVersions.some((item) => item.id === current) ? current : "current");
    })().catch(() => { if (active) setMessage("Не удалось загрузить матрицу."); });
    return () => { active = false; };
  }, [clientId, execution, mesocycleId, plans, program, programId, revision]);

  // Изменения плана или дневника — матрица перечитывается без потери позиции.
  useEffect(() => {
    const offPlans = plans.subscribeCommittedChanges((change) => { if (change.clientIds.includes(clientId)) setRevision((value) => value + 1); });
    const offExecution = execution.subscribeCommittedChanges((change) => {
      if (change.clientId === clientId && change.programId === programId) setRevision((value) => value + 1);
    });
    return () => { offPlans(); offExecution(); };
  }, [clientId, execution, plans, programId]);

  const version = versions?.find((item) => item.id === versionId) ?? versions?.[0];
  const matrix: ProgramMatrix | null = useMemo(() => version === undefined || lookup === null ? null
    : buildProgramMatrix(version.weeks, executions, (exerciseId) => diaryFields(lookup.get(exerciseId)?.metrics ?? []),
      { plan: planText, values: compactWithDrops }), [executions, lookup, version]);

  const items: readonly Item[] = useMemo(() => matrix === null ? [] : [
    ...matrix.sections.flatMap((section): Item[] => [{ kind: "section", key: `s:${section.key}`, title: section.title },
      ...section.rows.map((row): Item => ({ kind: "row", key: row.key, name: lookup?.get(row.exerciseId)?.name ?? "Упражнение",
        cells: row.cells }))]),
    { kind: "total", key: "total" },
  ], [lookup, matrix]);

  // Горизонтальная прокрутка — общий сдвиг для шапки и всех строк.
  const windowWidth = screenWidth - SIDE_PADDING * 2 - LABEL_WIDTH;
  const contentWidth = (matrix?.weeks.length ?? 0) * CELL_WIDTH;
  const maxOffset = Math.max(0, contentWidth - windowWidth);
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const limit = useSharedValue(maxOffset);
  useEffect(() => { limit.value = maxOffset; offset.value = Math.min(offset.value, maxOffset); }, [limit, maxOffset, offset]);
  const pan = useMemo(() => Gesture.Pan().activeOffsetX([-12, 12]).failOffsetY([-12, 12])
    .onStart(() => { start.value = offset.value; })
    .onUpdate((event) => { offset.value = Math.min(limit.value, Math.max(0, start.value - event.translationX)); })
    .onEnd((event) => { offset.value = withDecay({ velocity: -event.velocityX, clamp: [0, limit.value] }); }), [limit, offset, start]);

  // Позиция запоминается по мезоциклу и версии: 1 → 2 → 1 возвращает туда же (T05).
  const positionKey = `${mesocycleId ?? "simple"}:${version?.id ?? ""}`;
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const listRef = useRef<FlashListRef<Item>>(null);
  const currentY = useRef(0);
  const lastKey = useRef(positionKey);
  useEffect(() => {
    if (lastKey.current === positionKey) return;
    positions.current.set(lastKey.current, { x: offset.value, y: currentY.current });
    lastKey.current = positionKey;
    const saved = positions.current.get(positionKey) ?? { x: 0, y: 0 };
    offset.value = Math.min(saved.x, maxOffset);
    const frame = requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: saved.y, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [maxOffset, offset, positionKey]);

  const renderItem = useCallback(({ item }: Readonly<{ item: Item }>) => {
    if (item.kind === "section") {
      return <View style={[styles.section, { backgroundColor: colors.surfaceRaised }]}>
        <Text numberOfLines={1} style={[styles.sectionText, { color: colors.textPrimary }]}>{item.title}</Text>
      </View>;
    }
    if (item.kind === "total") {
      return <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, styles.total, { color: colors.textPrimary }]}>Тоннаж, кг</Text>
        <Shifted offset={offset} width={windowWidth}>
          {(matrix?.weeks ?? []).map((week) => (
            <View key={week.index} style={[styles.cell, { borderColor: colors.border }]}>
              <Text style={[styles.total, { color: colors.textPrimary }]}>{Math.round(matrix?.totals.get(week.index) ?? 0)}</Text>
            </View>
          ))}
        </Shifted>
      </View>;
    }
    return <View style={[styles.row, { borderColor: colors.border }]}>
      <Text numberOfLines={3} style={[styles.label, { color: colors.textPrimary }]}>{item.name}</Text>
      <Shifted offset={offset} width={windowWidth}>
        {(matrix?.weeks ?? []).map((week) => {
          const cell = item.cells.get(week.index);
          return <CellView key={week.index} cell={cell} onOpen={cell !== undefined && version?.current === true
            ? () => onOpenWorkout(week.index, cell.workoutId, mesocycleId) : null} />;
        })}
      </Shifted>
    </View>;
  }, [colors, matrix, mesocycleId, offset, onOpenWorkout, version, windowWidth]);

  if (message !== null) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><InlineNotice kind="error">{message}</InlineNotice></View>;
  if (program === null || versions === null || matrix === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Собираем матрицу…" /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.controls}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{program.title}</Text>
        {mesocycles.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {mesocycles.map((item) => (
              <SelectionChip key={item.id} group="Мезоцикл" label={item.title} selected={item.id === mesocycleId}
                onPress={() => { setMesocycleId(item.id); setVersionId("current"); }} />
            ))}
          </ScrollView>
        ) : null}
        <SearchableSelect title="Версия" value={version?.id ?? "current"}
          options={versions.map((item) => ({ value: item.id, label: item.label }))} onSelect={setVersionId} />
        {version?.current === false ? (
          <InlineNotice kind="info">Историческая версия — только просмотр. Дневник и действующий план не меняются.</InlineNotice>
        ) : null}
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.grid}>
          <View style={[styles.row, styles.header, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
            <Text style={[styles.label, styles.headText, { color: colors.textMuted }]}>Упражнение</Text>
            <Shifted offset={offset} width={windowWidth}>
              {matrix.weeks.map((week) => (
                // Колонка наследует цвет типа недели (UI-OWN-038).
                <View key={week.index} style={[styles.headCell, week.type === undefined ? null : {
                  backgroundColor: withAlpha(weekTypeTone(week.type, colors), 0.12), borderBottomWidth: 2,
                  borderBottomColor: weekTypeTone(week.type, colors) }]}>
                  <Text style={[styles.headText, { color: colors.textPrimary }]}>{`Неделя ${week.index}`}</Text>
                  {week.caption !== null ? <Text numberOfLines={1} style={[styles.caption, { color: week.type === undefined
                    ? colors.textSecondary : weekTypeTone(week.type, colors) }]}>{week.caption}</Text> : null}
                </View>
              ))}
            </Shifted>
          </View>
          {matrix.sections.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>В этой версии нет упражнений.</Text>
          ) : (
            <FlashList ref={listRef} data={items as Item[]} keyExtractor={(item) => item.key} getItemType={(item) => item.kind}
              renderItem={renderItem} extraData={renderItem}
              onScroll={(event) => { currentY.current = event.nativeEvent.contentOffset.y; }} />
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  controls: { paddingHorizontal: SIDE_PADDING, paddingTop: 12, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  chips: { gap: 8, paddingRight: 8 },
  grid: { flex: 1, marginTop: 10, paddingHorizontal: SIDE_PADDING },
  header: { borderBottomWidth: 1 },
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth },
  label: { width: LABEL_WIDTH, paddingVertical: 8, paddingRight: 8, fontFamily: fonts.medium, fontSize: 12, lineHeight: 15 },
  window: { overflow: "hidden" },
  track: { flexDirection: "row" },
  headCell: { width: CELL_WIDTH, paddingVertical: 6, paddingHorizontal: 6 },
  headText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  caption: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
  cell: { width: CELL_WIDTH, paddingVertical: 6, paddingHorizontal: 6, borderLeftWidth: StyleSheet.hairlineWidth, gap: 2,
    minHeight: 44, justifyContent: "center" },
  set: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  dash: { fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  section: { paddingVertical: 6, paddingHorizontal: 8, marginTop: 6, borderRadius: 6 },
  sectionText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  total: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingVertical: 16 },
});
