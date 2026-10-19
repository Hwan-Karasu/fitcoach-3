import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withDecay, type SharedValue } from "react-native-reanimated";
import { InlineNotice, LoadingState, SearchableSelect, SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { parseLoad, useExerciseLookup, weekTypeLabels, weekTypeTone, type ExerciseLookupPort, type Mesocycle,
  type TrainingPlansRepositoryPort, type TrainingProgram, type WeekType } from "../../plans/public.ts";
import type { SetValues } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { diaryFields, compactWithDrops, planText } from "./setFormat.ts";
import { buildProgramMatrix, type MatrixCell, type MatrixTarget, type MatrixWeek, type ProgramMatrix } from "./programMatrix.ts";

const LABEL_WIDTH = 112;
// Колонки недели, как в 2.0: «План / Пред. / Повт / Кг».
const PLAN_WIDTH = 50;
const PREV_WIDTH = 52;
const REPS_WIDTH = 40;
const LOAD_WIDTH = 48;
const CELL_WIDTH = PLAN_WIDTH + PREV_WIDTH + REPS_WIDTH + LOAD_WIDTH;
const SIDE_PADDING = 16;
const EMPTY: SetValues = { reps: null, loadGrams: null, durationSec: null, distanceM: null };

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

const kgText = (grams: number | null) => grams === null ? "" : (grams / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const volumeText = (kg: number) => Math.round(kg).toLocaleString("ru-RU");

type Item =
  | Readonly<{ kind: "section"; key: string; title: string }>
  | Readonly<{ kind: "exercise"; key: string; name: string }>
  | Readonly<{ kind: "set"; key: string; index: number; cells: ReadonlyMap<number, MatrixCell> }>
  | Readonly<{ kind: "volume"; key: string; label: string; values: ReadonlyMap<number, number>; strong: boolean }>;

/** Правая часть строки: ячейки недель, сдвинутые общей горизонтальной прокруткой. */
function Shifted({ offset, width, children }: Readonly<{ offset: SharedValue<number>; width: number; children: React.ReactNode }>) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -offset.value }] }));
  return <View style={[styles.window, { width }]}><Animated.View style={[styles.track, style]}>{children}</Animated.View></View>;
}

/** Ячейка факта: правка на месте, запись после окончания ввода (как в Google-таблице). */
const FactInput = memo(function FactInput({ value, width, label, keyboard, editable, onCommit }: Readonly<{
  value: string; width: number; label: string; keyboard: "number-pad" | "decimal-pad"; editable: boolean;
  onCommit: (text: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (!editable) return <Text numberOfLines={1} style={[styles.sub, styles.value, { width, color: colors.textPrimary }]}>{value || "—"}</Text>;
  return <TextInput value={text} onChangeText={setText} placeholder="—" placeholderTextColor={colors.textMuted} selectTextOnFocus
    keyboardType={keyboard} accessibilityLabel={label} returnKeyType="done" submitBehavior="blurAndSubmit"
    onEndEditing={() => { if (text.trim() !== value) onCommit(text); }}
    style={[styles.sub, styles.input, { width, color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.input }]} />;
});

/**
 * Матрица недель (T05, UI-OWN-045 по 2.0): таблица — строки подходов упражнений по тренировкам, у недели колонки
 * «План / Пред. / Повт / Кг»; повторы и вес правятся прямо в ячейке (тот же порт, что дневник; ревизия факта — CAS).
 * Названия слева и недели сверху закреплены, прокрутка по двум осям; колонка недели — в цвете её типа. Историческая
 * версия — только просмотр (§48.5.4). Позиция прокрутки запоминается по мезоциклу и версии.
 */
export function ProgramMatrixScreen({ clientId, programId, plans, execution, exercises }: Readonly<{
  clientId: string;
  programId: string;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  exercises: ExerciseLookupPort;
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
    ...matrix.sections.flatMap((section): Item[] => [
      { kind: "section", key: `s:${section.key}`, title: section.title },
      ...section.rows.flatMap((row): Item[] => {
        const count = Math.max(0, ...[...row.cells.values()].map((cell) => cell.sets.length));
        return [
          { kind: "exercise", key: `e:${row.key}`, name: lookup?.get(row.exerciseId)?.name ?? "Упражнение" },
          ...Array.from({ length: count }, (_, index): Item => ({ kind: "set", key: `p:${row.key}:${index}`, index, cells: row.cells })),
          { kind: "volume", key: `v:${row.key}`, label: "Объём", strong: false,
            values: new Map([...row.cells.entries()].map(([week, cell]) => [week, cell.volumeKg])) },
        ];
      }),
      { kind: "volume", key: `t:${section.key}`, label: "Объём тренировки", strong: true, values: section.totals },
    ]),
    { kind: "volume", key: "total", label: "Тоннаж недели", strong: true, values: matrix.totals },
  ], [lookup, matrix]);

  // Правка факта прямо в ячейке: тот же порт, что дневник; остальные значения подхода сохраняются.
  const save = useCallback((weekIndex: number, workoutId: string, target: MatrixTarget, patch: Partial<SetValues>) => {
    const fact = target.fact;
    setSaveError(null);
    void execution.saveSet({ slot: { clientId, programId, weekIndex, plannedWorkoutId: workoutId },
      plannedExerciseId: target.plannedExerciseId, exerciseId: target.exerciseId, plannedSetId: target.plannedSetId,
      position: target.position, metrics: lookup?.get(target.exerciseId)?.metrics ?? [],
      values: { ...(fact?.values ?? EMPTY), ...patch }, drops: fact?.drops ?? [], rpe: fact?.rpe ?? null,
      setType: fact?.setType ?? "NORMAL", expectedRevision: fact?.revision ?? null })
      .catch(() => { setSaveError("Не удалось сохранить значение — матрица обновлена, повторите ввод."); setRevision((value) => value + 1); });
  }, [clientId, execution, lookup, programId]);

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

  // Колонка недели целиком — в цвете её типа («Индивидуальная» — без окраски), как в 2.0.
  const tintOf = useCallback((type: WeekType | undefined, alpha: number) =>
    type === undefined || type === "base" ? "transparent" : withAlpha(weekTypeTone(type, colors), alpha), [colors]);
  const editable = version?.current === true;

  const renderItem = useCallback(({ item }: Readonly<{ item: Item }>) => {
    const weeks = matrix?.weeks ?? [];
    if (item.kind === "section") {
      return <View style={[styles.section, { backgroundColor: colors.surfaceRaised }]}>
        <Text numberOfLines={1} style={[styles.sectionText, { color: colors.textPrimary }]}>{item.title}</Text>
      </View>;
    }
    if (item.kind === "exercise") {
      return <View style={[styles.row, { borderColor: colors.border }]}>
        <Text numberOfLines={3} style={[styles.label, styles.exercise, { color: colors.textPrimary }]}>{item.name}</Text>
        <Shifted offset={offset} width={windowWidth}>
          {weeks.map((week) => <View key={week.index} style={[styles.cell, { borderColor: colors.border, backgroundColor: tintOf(week.type, 0.07) }]} />)}
        </Shifted>
      </View>;
    }
    if (item.kind === "volume") {
      return <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, item.strong ? styles.strong : styles.muted, { color: item.strong ? colors.textPrimary : colors.textSecondary }]}>
          {item.label}</Text>
        <Shifted offset={offset} width={windowWidth}>
          {weeks.map((week) => {
            const value = item.values.get(week.index);
            return <View key={week.index} style={[styles.cell, styles.volumeCell, { borderColor: colors.border, backgroundColor: tintOf(week.type, 0.07) }]}>
              <Text style={[item.strong ? styles.strong : styles.muted, { color: item.strong ? colors.textPrimary : colors.accentInk }]}>
                {value === undefined ? "—" : `${volumeText(value)} кг`}</Text>
            </View>;
          })}
        </Shifted>
      </View>;
    }
    const label = [...item.cells.values()].map((cell) => cell.sets[item.index]?.label).find((value) => value !== undefined) ?? "";
    return <View style={[styles.row, { borderColor: colors.border }]}>
      <Text style={[styles.label, styles.setLabel, { color: colors.textSecondary }]}>{label === "Р" ? "Разминка" : `Подход ${label}`}</Text>
      <Shifted offset={offset} width={windowWidth}>
        {weeks.map((week) => {
          const cell = item.cells.get(week.index);
          const set = cell?.sets[item.index];
          const tint = { borderColor: colors.border, backgroundColor: tintOf(week.type, 0.07) };
          if (cell === undefined || set === undefined) {
            return <View key={week.index} style={[styles.cell, styles.subRow, tint]}><Text style={[styles.dash, { color: colors.textMuted }]}>—</Text></View>;
          }
          const target = editable ? set.target : null;
          // Упражнение без повторов и веса (время, дистанция) и стороны — текстом, без правки в матрице.
          const plain = set.target === null || (!set.hasReps && !set.hasLoad);
          return <View key={week.index} style={[styles.cell, styles.subRow, tint]}>
            <Text numberOfLines={1} style={[styles.sub, { width: PLAN_WIDTH, color: colors.textSecondary }]}>{set.plan}</Text>
            <Text numberOfLines={1} style={[styles.sub, { width: PREV_WIDTH, color: colors.textMuted }]}>{set.previous ?? "—"}</Text>
            {plain ? <Text numberOfLines={1} style={[styles.sub, { width: REPS_WIDTH + LOAD_WIDTH,
              color: set.done ? colors.success : colors.textPrimary }]}>{set.fact ?? "—"}</Text> : <>
              <FactInput value={set.reps === null ? "" : String(set.reps)} width={REPS_WIDTH} keyboard="number-pad"
                label={`Неделя ${week.index}, подход ${set.label}: повторы`} editable={target !== null && set.hasReps}
                onCommit={(text) => {
                  const reps = text.trim() === "" ? null : Number.parseInt(text, 10);
                  if (target !== null && (reps === null || (Number.isInteger(reps) && reps >= 0 && reps <= 999))) save(week.index, cell.workoutId, target, { reps });
                }} />
              <FactInput value={kgText(set.loadGrams)} width={LOAD_WIDTH} keyboard="decimal-pad"
                label={`Неделя ${week.index}, подход ${set.label}: вес, кг`} editable={target !== null && set.hasLoad}
                onCommit={(text) => {
                  const loadGrams = parseLoad(text);
                  if (target !== null && loadGrams !== "invalid") save(week.index, cell.workoutId, target, { loadGrams });
                }} />
            </>}
          </View>;
        })}
      </Shifted>
    </View>;
  }, [colors, editable, matrix, offset, save, tintOf, windowWidth]);

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
        {saveError !== null ? <InlineNotice kind="error">{saveError}</InlineNotice> : null}
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.grid}>
          <View style={[styles.row, styles.header, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
            <Text style={[styles.label, styles.headText, { color: colors.textMuted }]}>Упражнение</Text>
            <Shifted offset={offset} width={windowWidth}>
              {matrix.weeks.map((week) => {
                const tone = week.type === undefined || week.type === "base" ? null : weekTypeTone(week.type, colors);
                return <View key={week.index} style={[styles.headCell, { borderColor: colors.border, backgroundColor: tintOf(week.type, 0.14),
                  borderBottomColor: tone ?? colors.border }]}>
                  <Text style={[styles.headText, { color: colors.textPrimary }]}>{`Неделя ${week.index}`}</Text>
                  {week.caption !== null ? <Text numberOfLines={1} style={[styles.caption, { color: tone ?? colors.textSecondary }]}>{week.caption}</Text> : null}
                  <View style={styles.subHead}>
                    {([["План", PLAN_WIDTH], ["Пред.", PREV_WIDTH], ["Повт", REPS_WIDTH], ["Кг", LOAD_WIDTH]] as const).map(([text, width]) => (
                      <Text key={text} style={[styles.subHeadText, { width, color: colors.textMuted }]}>{text}</Text>
                    ))}
                  </View>
                </View>;
              })}
            </Shifted>
          </View>
          {matrix.sections.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>В этой версии нет упражнений.</Text>
          ) : (
            <FlashList ref={listRef} data={items as Item[]} keyExtractor={(item) => item.key} getItemType={(item) => item.kind}
              renderItem={renderItem} extraData={renderItem} keyboardShouldPersistTaps="handled"
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
  label: { width: LABEL_WIDTH, paddingVertical: 6, paddingRight: 8, fontFamily: fonts.medium, fontSize: 12, lineHeight: 15 },
  exercise: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, paddingTop: 8 },
  setLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlignVertical: "center" },
  window: { overflow: "hidden" },
  track: { flexDirection: "row" },
  headCell: { width: CELL_WIDTH, paddingTop: 6, paddingBottom: 4, paddingHorizontal: 0, borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 2, alignItems: "center" },
  headText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  caption: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  subHead: { flexDirection: "row", marginTop: 4 },
  subHeadText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, textAlign: "center" },
  cell: { width: CELL_WIDTH, borderLeftWidth: StyleSheet.hairlineWidth, minHeight: 30 },
  subRow: { flexDirection: "row", alignItems: "center", minHeight: 40 },
  volumeCell: { alignItems: "center", justifyContent: "center", minHeight: 30 },
  sub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center", paddingHorizontal: 2 },
  value: { fontFamily: fonts.medium },
  input: { height: 32, borderWidth: 1, borderRadius: 6, paddingVertical: 0, marginHorizontal: 1, fontFamily: fonts.medium, fontSize: 12 },
  dash: { flex: 1, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  section: { paddingVertical: 6, paddingHorizontal: 8, marginTop: 6, borderRadius: 6 },
  sectionText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  strong: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingVertical: 16 },
});
