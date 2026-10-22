import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { InlineNotice, LoadingState, SearchableSelect, SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { parseLoad, useExerciseLookup, weekTypeLabels, weekTypeTone, type ExerciseLookupPort, type Mesocycle,
  type TrainingPlansRepositoryPort, type TrainingProgram, type WeekType } from "../../plans/public.ts";
import type { SetFact, SetValues } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { SerialWriteQueue } from "../application/SerialWriteQueue.ts";
import { diaryFields, compactWithDrops, planText } from "./setFormat.ts";
import { buildProgramMatrix, type MatrixTarget, type MatrixWeek, type ProgramMatrix } from "./programMatrix.ts";
import { buildMatrixHtml, matrixEditTargets, matrixStructureKey, matrixTexts, type MatrixHtmlView, type MatrixHtmlWeek } from "./matrixHtml.ts";
import { MATRIX_ZOOM } from "./matrixZoom.ts";

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

/**
 * Матрица недель (T05, UI-OWN-045 по 2.0): таблица — строки подходов упражнений по тренировкам, у недели колонки
 * «План / Пред. / Повт / Кг»; повторы и вес правятся прямо в ячейке (тот же порт, что дневник; ревизия факта — CAS).
 * Как в 2.0, таблица — страница в WebView: масштаб щипком и прокрутку по двум осям выполняет браузер (CSS zoom,
 * закреплённые названия и недели), поэтому масштаб плавный. Историческая версия — только просмотр (§48.5.4). Масштаб и
 * позиция запоминаются по мезоциклу и версии, пока экран открыт; обновление данных страницу не перезагружает.
 */
export function ProgramMatrixScreen({ clientId, programId, plans, execution, exercises, onProgramTitle }: Readonly<{
  clientId: string;
  programId: string;
  /** Название программы — в шапку экрана (вместо имени клиента). */
  onProgramTitle?: (title: string) => void;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  exercises: ExerciseLookupPort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const [program, setProgram] = useState<TrainingProgram | null>(null);
  const [mesocycles, setMesocycles] = useState<readonly Mesocycle[]>([]);
  const [mesocycleId, setMesocycleId] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly MatrixVersion[] | null>(null);
  const [versionId, setVersionId] = useState("current");
  const [executions, setExecutions] = useState<Awaited<ReturnType<TrainingExecutionPort["listProgramExecutions"]>>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  // Колбэк навигатора пересоздаётся при каждом рендере — читаем его из ref, иначе setOptions зациклится.
  const titleSink = useRef(onProgramTitle);
  titleSink.current = onProgramTitle;
  const programTitle = program?.title;
  useEffect(() => { if (programTitle !== undefined) titleSink.current?.(programTitle); }, [programTitle]);

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
  const editable = version?.current === true;

  // Правка факта прямо в ячейке: тот же порт, что дневник; остальные значения подхода сохраняются.
  // Записи идут по очереди, каждая берёт ревизию факта из ответа предыдущей (как в дневнике): повторы и вес подряд не дают STALE_SESSION.
  const queue = useRef(new SerialWriteQueue()).current;
  const acked = useRef(new Map<string, SetFact>());
  const save = useCallback((weekIndex: number, workoutId: string, target: MatrixTarget, patch: Partial<SetValues>) => {
    setSaveError(null);
    void queue.run(async () => {
      const latest = acked.current.get(target.plannedSetId);
      const fact = latest !== undefined && (target.fact === null || latest.revision >= target.fact.revision) ? latest : target.fact;
      const result = await execution.saveSet({ slot: { clientId, programId, weekIndex, plannedWorkoutId: workoutId },
        plannedExerciseId: target.plannedExerciseId, exerciseId: target.exerciseId, plannedSetId: target.plannedSetId,
        position: target.position, metrics: lookup?.get(target.exerciseId)?.metrics ?? [],
        values: { ...(fact?.values ?? EMPTY), ...patch }, drops: fact?.drops ?? [], rpe: fact?.rpe ?? null,
        setType: fact?.setType ?? "NORMAL", expectedRevision: fact?.revision ?? null });
      acked.current.set(target.plannedSetId, result.fact);
    }, { onError: () => { setSaveError("Не удалось сохранить значение — матрица обновлена, повторите ввод."); setRevision((value) => value + 1); } });
  }, [clientId, execution, lookup, programId, queue]);

  // Правка из страницы: идентификатор ячейки → цель записи; значение проверяется, как раньше в поле ввода.
  const targets = useMemo(() => matrix === null ? null : matrixEditTargets(matrix), [matrix]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const onEdit = useCallback((id: string, field: string, text: string) => {
    const found = targetsRef.current?.get(id);
    if (found === undefined || !editable) return;
    if (field === "reps") {
      const reps = text.trim() === "" ? null : Number.parseInt(text, 10);
      if (reps === null || (Number.isInteger(reps) && reps >= 0 && reps <= 999)) save(found.weekIndex, found.workoutId, found.target, { reps });
    } else if (field === "load") {
      const loadGrams = parseLoad(text);
      if (loadGrams !== "invalid") save(found.weekIndex, found.workoutId, found.target, { loadGrams });
    }
  }, [editable, save]);

  // Масштаб и позиция запоминаются по мезоциклу и версии (1 → 2 → 1 возвращает туда же, T05); нужны при пересборке страницы.
  const positionKey = `${mesocycleId ?? "simple"}:${version?.id ?? ""}`;
  const views = useRef(new Map<string, MatrixHtmlView>());
  const lastZoom = useRef<number>(MATRIX_ZOOM.initial);
  const positionKeyRef = useRef(positionKey);
  positionKeyRef.current = positionKey;

  // Колонка недели целиком — в цвете её типа («Индивидуальная» — без окраски), как в 2.0.
  const tintOf = useCallback((type: WeekType | undefined, alpha: number) =>
    type === undefined || type === "base" ? "transparent" : withAlpha(weekTypeTone(type, colors), alpha), [colors]);
  const htmlWeeks: readonly MatrixHtmlWeek[] = useMemo(() => (matrix?.weeks ?? []).map((week) => ({ index: week.index, caption: week.caption,
    tone: week.type === undefined || week.type === "base" ? null : weekTypeTone(week.type, colors),
    tint: tintOf(week.type, 0.07), headTint: tintOf(week.type, 0.14) })), [colors, matrix?.weeks, tintOf]);

  // Страница собирается заново только при смене структуры, цветов или позиции; значения обновляются через patch.
  const structureKey = matrix === null ? "" : `${positionKey}|${matrixStructureKey(matrix, editable)}|${colors.canvas}|${colors.accentInk}`;
  const matrixRef = useRef(matrix);
  matrixRef.current = matrix;
  const html = useMemo(() => {
    const current = matrixRef.current;
    if (current === null) return "";
    const saved = views.current.get(positionKeyRef.current);
    return buildMatrixHtml(current, (exerciseId) => lookup?.get(exerciseId)?.name ?? "Упражнение", htmlWeeks,
      { canvas: colors.canvas, surface: colors.surfaceRaised, border: colors.border, text: colors.textPrimary, textSecondary: colors.textSecondary,
        textMuted: colors.textMuted, accentInk: colors.accentInk, success: colors.success, input: colors.input }, editable,
      { zoom: saved?.zoom ?? lastZoom.current, x: saved?.x ?? 0, y: saved?.y ?? 0 });
  }, [structureKey]);

  const web = useRef<WebView>(null);
  const texts = useMemo(() => matrix === null ? null : matrixTexts(matrix), [matrix]);
  const patch = useCallback(() => {
    if (texts !== null) web.current?.injectJavaScript(`window.fitcoachMatrix&&window.fitcoachMatrix.patch(${JSON.stringify(texts)});true;`);
  }, [texts]);
  useEffect(patch, [patch]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string; field?: string; text?: string; zoom?: number; x?: number; y?: number };
      if (data.type === "edit" && typeof data.id === "string" && typeof data.field === "string" && typeof data.text === "string") onEdit(data.id, data.field, data.text);
      else if (data.type === "view" && typeof data.zoom === "number" && typeof data.x === "number" && typeof data.y === "number") {
        lastZoom.current = data.zoom;
        views.current.set(positionKeyRef.current, { zoom: data.zoom, x: data.x, y: data.y });
      }
    } catch { /* Чужое сообщение — игнорируем. */ }
  }, [onEdit]);

  if (message !== null) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><InlineNotice kind="error">{message}</InlineNotice></View>;
  if (program === null || versions === null || matrix === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Собираем матрицу…" /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.controls}>
        <SearchableSelect title="Версия" value={version?.id ?? "current"}
          options={versions.map((item) => ({ value: item.id, label: item.label }))} onSelect={setVersionId} />
        {mesocycles.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {mesocycles.map((item) => (
              <SelectionChip key={item.id} group="Мезоцикл" label={item.title} selected={item.id === mesocycleId}
                onPress={() => { setMesocycleId(item.id); setVersionId("current"); }} />
            ))}
          </ScrollView>
        ) : null}
        {version?.current === false ? (
          <InlineNotice kind="info">Историческая версия — только просмотр. Дневник и действующий план не меняются.</InlineNotice>
        ) : null}
        {saveError !== null ? <InlineNotice kind="error">{saveError}</InlineNotice> : null}
      </View>
      <View style={[styles.grid, { backgroundColor: colors.canvas }]}>
        <WebView ref={web} key={structureKey} originWhitelist={["*"]} source={{ html }} onMessage={onMessage} onLoadEnd={patch}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false}
          mixedContentMode="never" setSupportMultipleWindows={false} hideKeyboardAccessoryView keyboardDisplayRequiresUserAction={false}
          overScrollMode="never" bounces={false} style={styles.web} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  controls: { paddingHorizontal: SIDE_PADDING, paddingTop: 12, gap: 10 },
  chips: { gap: 8, paddingRight: 8 },
  grid: { flex: 1, marginTop: 10, paddingHorizontal: SIDE_PADDING },
  web: { flex: 1, backgroundColor: "transparent" },
});
