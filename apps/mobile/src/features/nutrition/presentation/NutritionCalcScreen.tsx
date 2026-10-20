import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, LoadingState, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { dailyPoints, latestPoint, localDateOf, MeasurementsCard, navyBodyFat, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { CALC_ACTIVITIES, CALC_GOALS, CALC_INTENSITIES, DEFAULT_TOLERANCE, calcMacros, deriveCalc, proposeCorridors, type CalcActivity, type CalcGoal, type CalcIntensity,
  type CalcProfile, type CalcSex } from "../domain/CalcRules.ts";
import type { NutritionCalcPort, StoredCalcProfile } from "../domain/NutritionCalcPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS } from "../domain/TargetModel.ts";
import { metricLabels, nutritionErrorText, rangeText, shiftDate } from "./nutritionFormat.ts";

const goalLabels: Readonly<Record<CalcGoal, string>> = { LOSS: "Похудение", MAINTENANCE: "Поддержание", GAIN: "Набор" };
const activityLabels: Readonly<Record<CalcActivity, string>> = { SEDENTARY: "Сидячий", MODERATE: "Умеренный", ACTIVE: "Активный", VERY_ACTIVE: "Очень активный" };
const intensityLabels: Readonly<Record<CalcIntensity, string>> = { LIGHT: "Лёгкая", MEDIUM: "Средняя", HEAVY: "Тяжёлая" };
const STEPS_WINDOW_DAYS = 30;

/** Профиль по умолчанию: «не введено» остаётся пустым, а не угаданным (§49.10 п. 4); тренировок нет, пока тренер их не укажет. */
const DEFAULT_PROFILE: CalcProfile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 0, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };

/** «85,4» / «85.4» → число; пусто, лишние знаки и буквы → `null`. Допускается одна десятая. */
function num(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  return /^\d{1,4}(\.\d)?$/u.test(normalized) ? Number(normalized) : null;
}
const show = (value: number | null) => value === null ? "" : String(value).replace(".", ",");

/** Данные карточки клиента для расчёта: пол и рост правятся здесь и записываются обратно в карточку, возраст считается из даты рождения. */
export interface CalcClientBody {
  readonly sex: CalcSex | null;
  readonly age: number | null;
  readonly heightCm: number | null;
}

interface Draft {
  sex: CalcSex | null; height: string; weight: string; fat: string; activity: CalcActivity; workouts: string; minutes: string; step: string; intensity: CalcIntensity;
  neck: string; waist: string; hips: string;
}

function draftOf(profile: CalcProfile, body: CalcClientBody, weight: number | null, fat: number | null): Draft {
  return { sex: body.sex, height: show(body.heightCm), weight: show(weight), fat: show(fat), activity: profile.activity, workouts: String(profile.workoutsPerWeek),
    minutes: String(profile.minutes), step: String(profile.stepKcal), intensity: profile.intensity, neck: "", waist: "", hips: "" };
}

function profileOf(draft: Draft, goal: CalcGoal): CalcProfile {
  const whole = (text: string, fallback: number) => text.trim() === "" ? fallback : (num(text) ?? Number.NaN);
  return { goal, activity: draft.activity,
    workoutsPerWeek: whole(draft.workouts, 0), minutes: whole(draft.minutes, 60), intensity: draft.intensity, stepKcal: whole(draft.step, 100) };
}

function calcErrorText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "CALC_PROFILE_INVALID": return "Проверьте поля: возраст 1–120, рост 50–300 см, тренировок 0–21 в неделю, минут 1–600, шаг цели 0–1000 ккал.";
    case "CALC_STALE": return "Профиль уже изменился. Данные обновлены — повторите действие.";
    case "MEASUREMENT_VALUE_INVALID": return "Вес и процент жира вне допустимого диапазона.";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_AMBIGUOUS_TODAY": return "За сегодня несколько записей веса или % жира. Выберите основную в журнале замеров и повторите.";
    default: return nutritionErrorText(error);
  }
}

function Card({ title, right, children }: Readonly<{ title: string; right?: React.ReactNode; children: React.ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.cardHead}>
        <View style={[styles.dot, { backgroundColor: colors.accentInk }]} />
        <Text style={[styles.cardTitle, { color: colors.accentInk }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Stat({ label, value, caption, accent }: Readonly<{ label: string; value: number | null; caption: string; accent?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessible accessibilityLabel={`${label}: ${value === null ? "нет данных" : value}. ${caption}`}
      style={[styles.stat, { borderColor: colors.border, backgroundColor: accent === true ? colors.accentSoft : colors.surfaceRaised }]}>
      <Text style={[styles.statLabel, { color: accent === true ? colors.accentInk : colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value === null ? "—" : String(value)}</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>{caption}</Text>
    </View>
  );
}

function HelpSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const items: readonly (readonly [string, string])[] = [
    ["Стартовый расход", "Оценка суточного расхода энергии: REE + NEAT + EAT. Это расчёт по формулам, а не измеренный расход."],
    ["REE — базовый обмен", "При известных весе и % жира — Кэтч–Макардл: 370 + 21,6 × сухая масса. Иначе — Миффлин–Сан-Жеор по полу, возрасту, росту и весу. Без данных значение не показывается."],
    ["NEAT — повседневная активность", "По средним шагам за последние 30 дней и весу (0,03–0,06 ккал на шаг). Без шагов — по образу жизни: 180 / 260 / 360 / 460 ккал."],
    ["EAT — тренировки", "MET × 3,5 × вес ÷ 200 × минуты × тренировок в неделю ÷ 7. MET: лёгкая 3,5, средняя 5, тяжёлая 6."],
    ["Итоговый калораж", "Стартовый расход с поправкой на цель: «Шаг цели» вычитается при похудении и прибавляется при наборе."],
    ["Предложенные цели", "Коридоры ±5 % по калориям и ±10 % по Б/Ж/У. Это черновик: он не становится целью, пока вы не нажмёте «Применить как цели». Б и Ж считаются от сухой массы, поэтому нужны вес и % жира."],
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>Как считается расчёт</Text>
          <ScrollView contentContainerStyle={styles.dialogBody}>
            {items.map(([title, body]) => (
              <View key={title} style={styles.helpItem}>
                <Text style={[styles.helpTitle, { color: colors.textPrimary }]}>{title}</Text>
                <Text style={[styles.hintBody, { color: colors.textSecondary }]}>{body}</Text>
              </View>
            ))}
          </ScrollView>
          <AppButton label="Понятно" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Экран «Расчёт» (§49.10, UX «Расчёт»): просмотр и редактирование — состояния одного экрана; вес и % жира берутся из Measurements, шаги — из суточной активности.
 * Результат — оценка и черновик целей; действующей целью он становится только после явного «Применить как цели».
 */
export function NutritionCalcScreen({ clientId, body, onUpdateBody, calc, targets, measurements }: Readonly<{ clientId: string; body: CalcClientBody;
  /** Записывает пол и рост в карточку клиента (владелец данных — Clients). */
  onUpdateBody: (patch: Readonly<{ sex: CalcSex | null; heightCm: number | null }>) => Promise<void>; calc: NutritionCalcPort; targets: NutritionTargetsPort; measurements: MeasurementRepositoryPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [loaded, setLoaded] = useState<Readonly<{ stored: StoredCalcProfile | null; weight: number | null; fat: number | null; steps: number | null }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [navyOpen, setNavyOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tolerance, setTolerance] = useState({ kcal: String(DEFAULT_TOLERANCE.kcalPercent), macro: String(DEFAULT_TOLERANCE.macroPercent) });
  const [confirmApply, setConfirmApply] = useState<string | null>(null);
  /** Замок от двойного нажатия: state `busy` обновляется асинхронно, ref — сразу. */
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    const today = localDateOf(new Date());
    void Promise.all([calc.getProfile(clientId), measurements.listForClient(clientId), calc.averageSteps(clientId, shiftDate(today, -STEPS_WINDOW_DAYS + 1), today)]).then(([stored, data, steps]) => {
      if (!active) return;
      const point = (type: "WEIGHT" | "BODY_FAT") => { const latest = latestPoint(data.measurements, data.primaries, type); return latest !== null && latest.kind === "VALUE" ? latest.measurement.valueX10 / 10 : null; };
      setLoaded({ stored, weight: point("WEIGHT"), fat: point("BODY_FAT"), steps });
      setFailed(false);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [calc, measurements, clientId, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offCalc = calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    const offMeasurements = measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offCalc(); offMeasurements(); };
  }, [calc, measurements, clientId]);

  const profile = loaded?.stored?.profile ?? DEFAULT_PROFILE;
  /** Что считать: в редактировании — живой черновик, иначе сохранённый профиль и последние замеры. */
  const live = useMemo(() => {
    if (loaded === null) return null;
    if (editing && draft !== null) {
      const goal = profile.goal;
      const parsed = profileOf(draft, goal);
      const clean = Object.values(parsed).every((value) => typeof value !== "number" || Number.isFinite(value));
      return { profile: clean ? parsed : profile, sex: draft.sex, heightCm: num(draft.height), weight: num(draft.weight), fat: num(draft.fat) };
    }
    return { profile, sex: body.sex, heightCm: body.heightCm, weight: loaded.weight, fat: loaded.fat };
  }, [loaded, editing, draft, profile, body]);
  const result = useMemo(() => live === null || loaded === null ? null : deriveCalc(live.profile, { sex: live.sex, age: body.age, heightCm: live.heightCm, weightKg: live.weight, fatPercent: live.fat, avgSteps: loaded.steps }), [live, loaded]);

  const navy = useMemo(() => draft === null ? null : navyBodyFat({ sex: draft.sex, heightCm: num(draft.height), neckCm: num(draft.neck), waistCm: num(draft.waist), hipsCm: num(draft.hips) }), [draft]);

  const startEdit = () => {
    if (loaded === null) return;
    setDraft(draftOf(profile, body, loaded.weight, loaded.fat));
    setNavyOpen(false);
    setError(null);
    setNotice(null);
    setEditing(true);
  };

  const selectGoal = useCallback(async (goal: CalcGoal) => {
    if (loaded === null || lock.current || goal === profile.goal) return;
    lock.current = true;
    setBusy(true);
    try { await calc.saveProfile(clientId, { ...profile, goal }, loaded.stored?.revision ?? null); setError(null); } catch (failure) { setError(calcErrorText(failure)); setTick((value) => value + 1); }
    lock.current = false;
    setBusy(false);
  }, [loaded, profile, calc, clientId]);

  const done = async () => {
    if (loaded === null || draft === null || lock.current) return;
    const next = profileOf(draft, profile.goal);
    if (draft.height.trim() !== "" && (num(draft.height) === null || (num(draft.height) as number) < 50 || (num(draft.height) as number) > 300)) { setError("Рост — от 50 до 300 см, например 181 или 172,5."); return; }
    const weight = draft.weight.trim() === "" ? null : num(draft.weight);
    const fat = draft.fat.trim() === "" ? null : num(draft.fat);
    if ((draft.weight.trim() !== "" && weight === null) || (draft.fat.trim() !== "" && fat === null)) { setError("Вес и % жира — числа с одним знаком после запятой, например 85,4."); return; }
    if ((weight !== null && (weight < 20 || weight > 400)) || (fat !== null && (fat < 2 || fat > 75))) { setError("Вес — от 20 до 400 кг, процент жира — от 2 до 75."); return; }
    lock.current = true;
    setBusy(true);
    try {
      await calc.saveProfile(clientId, next, loaded.stored?.revision ?? null);
      const heightCm = draft.height.trim() === "" ? null : num(draft.height);
      if (draft.sex !== body.sex || heightCm !== body.heightCm) await onUpdateBody({ sex: draft.sex, heightCm });
      // Вес и % жира — факты Measurements: новая запись только при изменённом значении, без параллельного хранилища.
      const today = localDateOf(new Date());
      const journal = await measurements.listForClient(clientId);
      const write = async (type: "WEIGHT" | "BODY_FAT", value: number | null, current: number | null) => {
        if (value === null || value === current) return;
        const input = { type, valueX10: Math.round(value * 10), localDate: today, localMinute: null };
        const point = dailyPoints(journal.measurements, journal.primaries, type).find((candidate) => candidate.localDate === today);
        // За сегодня уже есть значение — исправляем его, а не добавляем вторую запись, иначе день станет неоднозначным (§49.15, §49.18).
        if (point === undefined) await measurements.record(clientId, input);
        else if (point.kind === "VALUE") await measurements.correct(point.measurement.id, point.measurement.revision, { ...input, localMinute: point.measurement.localMinute });
        else throw new Error("MEASUREMENT_AMBIGUOUS_TODAY");
      };
      await write("WEIGHT", weight, loaded.weight);
      await write("BODY_FAT", fat, loaded.fat);
      setEditing(false);
      setError(null);
    } catch (failure) { setError(calcErrorText(failure)); setTick((value) => value + 1); }
    lock.current = false;
    setBusy(false);
  };

  const tol = { kcalPercent: num(tolerance.kcal) ?? Number.NaN, macroPercent: num(tolerance.macro) ?? Number.NaN };
  const tolValid = [tol.kcalPercent, tol.macroPercent].every((value) => Number.isFinite(value) && value >= 0 && value < 100);
  const proposal = useMemo(() => {
    if (result === null || !tolValid) return null;
    const macros = calcMacros(result.leanMassKg, result.target, profile.goal);
    return proposeCorridors(result.target, macros, tol);
  }, [result, tolValid, tol.kcalPercent, tol.macroPercent, profile.goal]);
  const hasProposal = proposal !== null && TARGET_METRICS.some((metric) => proposal[metric] !== null);

  const askApply = async () => {
    if (proposal === null || lock.current) return;
    try {
      const existing = (await targets.listVersions(clientId)).find((version) => version.effectiveFrom === localDateOf(new Date()));
      setConfirmApply(existing === undefined
        ? "С сегодняшней даты на все дни недели будут действовать эти коридоры. Прошлые версии целей и особые цели на даты сохраняются."
        : "На сегодняшнюю дату цели уже заданы. Они будут заменены этими коридорами на все дни недели: прежние значения по дням, которых нет в предложении, пропадут. Прошлые версии и особые цели на даты сохраняются.");
    } catch (failure) { setError(calcErrorText(failure)); }
  };
  const apply = async () => {
    setConfirmApply(null);
    if (proposal === null || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const today = localDateOf(new Date());
      const existing = (await targets.listVersions(clientId)).find((version) => version.effectiveFrom === today);
      await targets.saveVersion(clientId, { effectiveFrom: today, days: Array.from({ length: 7 }, () => proposal) }, existing?.revision ?? null);
      setNotice("Цели сохранены с сегодняшней даты. Уточнить границы по дням можно на вкладке «Цели».");
      setError(null);
    } catch (failure) { setError(calcErrorText(failure)); }
    lock.current = false;
    setBusy(false);
  };

  if (loaded === null || result === null || live === null) {
    return failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить расчёт.</InlineNotice></View> : <LoadingState label="Загружаем расчёт…" />;
  }
  const missing = result.startTdee === null;
  const setField = (patch: Partial<Draft>) => setDraft((current) => current === null ? current : { ...current, ...patch });

  const headerButtons = (
    <View style={styles.headButtons}>
      <AppButton compact variant="secondary" label="?" accessibilityLabel="Справка по расчёту" onPress={() => setHelp(true)} />
      {editing ? <AppButton compact label="Готово" busy={busy} onPress={() => { void done(); }} />
        : <AppButton compact variant="secondary" label="Изменить" disabled={busy} onPress={startEdit} />}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}
      <Card title={editing ? "ПРОФИЛЬ И АКТИВНОСТЬ" : "РАСЧЁТ"} right={headerButtons}>
        {editing && draft !== null ? <>
          <Stat label="СТАРТОВЫЙ РАСХОД" value={result.startTdee} caption="REE + NEAT + EAT" />
          <Stat label="ИТОГОВЫЙ КАЛОРАЖ" value={result.target} caption={goalLabels[profile.goal]} accent />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Пол</Text>
          <View style={styles.chips}>
            {(["MALE", "FEMALE"] as const).map((id) => <SelectionChip key={id} group="Пол" label={id === "MALE" ? "Мужской" : "Женский"} selected={draft.sex === id} onPress={() => setField({ sex: id })} />)}
          </View>
          <View style={styles.pair}>
            <View style={styles.grow} accessible accessibilityLabel={`Возраст: ${body.age === null ? "не указан" : `${body.age} лет`}`}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Возраст</Text>
              <Text style={[styles.resultValue, { color: colors.textPrimary }]}>{body.age === null ? "—" : `${body.age} лет`}</Text>
              <Text style={[styles.hint, { color: colors.textMuted }]}>{body.age === null ? "Укажите дату рождения в карточке клиента." : "Из даты рождения в карточке клиента."}</Text>
            </View>
            <View style={styles.grow}><TextField label="Рост, см" value={draft.height} onChangeText={(height) => setField({ height })} keyboardType="decimal-pad" placeholder="0" /></View>
          </View>
          <View style={styles.pair}>
            <View style={styles.grow}><TextField label="Вес, кг" value={draft.weight} onChangeText={(weight) => setField({ weight })} keyboardType="decimal-pad" placeholder="0" /></View>
            <View style={styles.grow}><TextField label="% жира" value={draft.fat} onChangeText={(fat) => setField({ fat })} keyboardType="decimal-pad" placeholder="0" /></View>
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>Вес и % жира сохраняются как замеры; значения с одним знаком после запятой.</Text>

          <View style={[styles.nested, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            <View style={styles.nestedHead}>
              <Text style={[styles.nestedTitle, { color: colors.textPrimary }]}>Калькулятор % жира (ВМС США)</Text>
              <AppButton compact variant={navyOpen ? "secondary" : "ghost"} label={navyOpen ? "Свернуть" : "Развернуть"} accessibilityLabel={navyOpen ? "Свернуть калькулятор процента жира" : "Развернуть калькулятор процента жира"}
                onPress={() => setNavyOpen(!navyOpen)} />
            </View>
            {navyOpen ? <>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
              {draft.sex === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Выберите пол — формула для мужчин и женщин разная.</Text> : null}
              {num(draft.height) === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Рост берётся из поля «Рост» профиля выше.</Text> : null}
              <View style={styles.pair}>
                <View style={styles.grow}><TextField label="Шея, см" value={draft.neck} onChangeText={(neck) => setField({ neck })} keyboardType="decimal-pad" placeholder="0" /></View>
                <View style={styles.grow}><TextField label="Талия, см" value={draft.waist} onChangeText={(waist) => setField({ waist })} keyboardType="decimal-pad" placeholder="0" /></View>
                {draft.sex === "FEMALE" ? <View style={styles.grow}><TextField label="Бёдра, см" value={draft.hips} onChangeText={(hips) => setField({ hips })} keyboardType="decimal-pad" placeholder="0" /></View> : null}
              </View>
              <View style={styles.resultRow} accessible accessibilityLabel={`Результат: ${navy === null ? "нет данных" : `${navy} процентов`}`}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Результат</Text>
                <Text style={[styles.resultValue, { color: colors.textPrimary }]}>{navy === null ? "—" : `${String(navy).replace(".", ",")} %`}</Text>
              </View>
              <Text style={[styles.hint, { color: colors.textMuted }]}>Оценка по окружностям, а не точное измерение состава тела.</Text>
              <AppButton label="Подставить в профиль" disabled={navy === null} disabledReason="Введите пол, рост, шею и талию (женщинам — и бёдра)." onPress={() => { if (navy !== null) setField({ fat: show(navy) }); }} />
            </> : null}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Образ жизни</Text>
          <View style={styles.chips}>
            {CALC_ACTIVITIES.map((id) => <SelectionChip key={id} group="Образ жизни" label={activityLabels[id]} selected={draft.activity === id} onPress={() => setField({ activity: id })} />)}
          </View>
          <View style={styles.pair}>
            <View style={styles.grow}><TextField label="Тренировок в неделю" value={draft.workouts} onChangeText={(workouts) => setField({ workouts })} keyboardType="decimal-pad" placeholder="0" /></View>
            <View style={styles.grow}><TextField label="Минут в тренировке" value={draft.minutes} onChangeText={(minutes) => setField({ minutes })} keyboardType="decimal-pad" placeholder="0" /></View>
          </View>
          <TextField label="Шаг цели, ккал" value={draft.step} onChangeText={(step) => setField({ step })} keyboardType="decimal-pad" placeholder="0"
            hint="Поправка калорий для похудения и набора — это не количество шагов." />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Интенсивность</Text>
          <View style={styles.chips}>
            {CALC_INTENSITIES.map((id) => <SelectionChip key={id} group="Интенсивность" label={intensityLabels[id]} selected={draft.intensity === id} onPress={() => setField({ intensity: id })} />)}
          </View>
        </> : <>
          <View style={styles.cols}>
            <View style={styles.leftCol}>
              <Stat label="СТАРТОВЫЙ РАСХОД" value={result.startTdee} caption="REE + NEAT + EAT" />
              <Stat label="ИТОГОВЫЙ КАЛОРАЖ" value={result.target} caption={goalLabels[profile.goal]} accent />
            </View>
            <View style={[styles.goalCard, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>ЦЕЛЬ</Text>
              {CALC_GOALS.map((id) => <AppButton key={id} compact variant={profile.goal === id ? "primary" : "secondary"} label={goalLabels[id]} disabled={busy} accessibilityLabel={`Цель: ${goalLabels[id]}${profile.goal === id ? ", выбрано" : ""}`}
                onPress={() => { void selectGoal(id); }} />)}
            </View>
          </View>
          <View style={[styles.strip, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            {([["REE", result.ree, "базовый обмен"], ["NEAT", result.neat, result.neatSource === "STEPS" ? "по шагам" : "по образу жизни"], ["EAT", result.eat, "по тренировкам"]] as const).map(([title, value, caption], index) => (
              <View key={title} accessible accessibilityLabel={`${title}: ${value === null ? "нет данных" : value}, ${caption}`} style={[styles.stripCell, index > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : null]}>
                <Text style={[styles.statLabel, { color: colors.accentInk }]}>{title}</Text>
                <Text style={[styles.stripValue, { color: colors.textPrimary }]}>{value === null ? "—" : String(value)}</Text>
                <Text style={[styles.hint, { color: colors.textMuted }]}>{caption}</Text>
              </View>
            ))}
          </View>
          {missing ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Для расчёта нужны пол, возраст, рост и вес (или вес с процентом жира). Нажмите «Изменить», чтобы заполнить профиль.</Text> : null}
        </>}
      </Card>

      {!editing ? <Card title="ПРЕДЛОЖЕНИЕ ЦЕЛЕЙ">
        <View style={styles.pair}>
          <View style={styles.grow}><TextField label="Допуск ккал, ±%" value={tolerance.kcal} onChangeText={(kcal) => setTolerance({ ...tolerance, kcal })} keyboardType="decimal-pad" /></View>
          <View style={styles.grow}><TextField label="Допуск Б/Ж/У, ±%" value={tolerance.macro} onChangeText={(macro) => setTolerance({ ...tolerance, macro })} keyboardType="decimal-pad" /></View>
        </View>
        {TARGET_METRICS.map((metric) => <View key={metric} style={styles.resultRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{metricLabels[metric]}</Text>
          <Text style={[styles.resultValue, { color: colors.textPrimary }]}>{proposal === null || proposal[metric] === null ? "—" : rangeText(proposal[metric])}</Text>
        </View>)}
        <Text style={[styles.hint, { color: colors.textMuted }]}>Черновик по расчёту. Белки и жиры считаются от сухой массы — нужны вес и % жира; без них они остаются «—».</Text>
        <AppButton label="Применить как цели" busy={busy} disabled={!hasProposal} disabledReason="Сначала заполните данные расчёта." onPress={() => { void askApply(); }} />
      </Card> : null}

      <MeasurementsCard clientId={clientId} repository={measurements} />

      <HelpSheet visible={help} onClose={() => setHelp(false)} />
      <ConfirmDialog visible={confirmApply !== null} title="Применить как цели?" confirmLabel="Применить" onCancel={() => setConfirmApply(null)} onConfirm={() => { void apply(); }} description={confirmApply ?? ""} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  card: { ...shadow.card, borderRadius: 24, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
  headButtons: { flexDirection: "row", gap: 8, alignItems: "center" },
  cols: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  leftCol: { flex: 1, gap: 10 },
  stat: { borderRadius: 18, borderWidth: 1, padding: 12, gap: 2 },
  statLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.5 },
  statValue: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32 },
  goalCard: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 10, gap: 8, justifyContent: "center" },
  strip: { flexDirection: "row", borderRadius: 18, borderWidth: 1 },
  stripCell: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, gap: 2 },
  stripValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  hintBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pair: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  nested: { borderRadius: 18, borderWidth: 1, padding: 12, gap: 10 },
  nestedHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  nestedTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  rule: { height: StyleSheet.hairlineWidth },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  resultValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10, maxHeight: "90%" },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  dialogBody: { gap: 12 },
  helpItem: { gap: 2 },
  helpTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
