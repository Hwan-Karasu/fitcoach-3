import { useCallback, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, ChoiceSegments, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { plural } from "../../../shared/format/clockText.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { localDateOf, MeasurementsCard, navyBodyFat, upsertDailyMeasurement, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { CALC_ACTIVITIES, CALC_GOALS, CALC_INTENSITIES, deriveCalc, type CalcActivity, type CalcGoal, type CalcIntensity,
  type CalcProfile, type CalcSex } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import { DEFAULT_CALC_PROFILE, useCalcData } from "./useCalcData.ts";
import { nutritionErrorText } from "./nutritionFormat.ts";

const goalLabels: Readonly<Record<CalcGoal, string>> = { LOSS: "Похудение", MAINTENANCE: "Поддержание", GAIN: "Набор" };
const activityLabels: Readonly<Record<CalcActivity, string>> = { SEDENTARY: "Сидячий", MODERATE: "Умеренный", ACTIVE: "Активный", VERY_ACTIVE: "Очень активный" };
const intensityLabels: Readonly<Record<CalcIntensity, string>> = { LIGHT: "Лёгкая", MEDIUM: "Средняя", HEAVY: "Тяжёлая" };


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
    case "MEASUREMENT_AMBIGUOUS_DAY": return "За сегодня несколько записей веса или % жира. Выберите основную в журнале замеров и повторите.";
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
      {caption !== "" ? <Text style={[styles.statCaption, { color: colors.textMuted }]}>{caption}</Text> : null}
    </View>
  );
}

function HelpSheet({ visible, onClose }: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const items: readonly (readonly [string, string])[] = [
    ["Стартовый расход", "Оценка суточного расхода энергии: REE + NEAT + EAT. Это расчёт по формулам, а не измеренный расход."],
    ["REE — базовый обмен", "При известных весе и % жира — Кэтч–Макардл: 370 + 21,6 × сухая масса. Иначе — Миффлин–Сан-Жеор по полу, возрасту, росту и весу. Без данных значение не показывается."],
    ["NEAT — повседневная активность", "По средним шагам за последние 7 дней и весу (0,03–0,06 ккал на шаг). Без шагов — по образу жизни: 180 / 260 / 360 / 460 ккал."],
    ["EAT — тренировки", "MET × 3,5 × вес ÷ 200 × минуты × тренировок в неделю ÷ 7. MET: лёгкая 3,5, средняя 5, тяжёлая 6."],
    ["Итоговый калораж", "Стартовый расход с поправкой на цель: «Шаг цели» вычитается при похудении и прибавляется при наборе."],
    ["Цели", "Расчёт — справочный и цели не меняет. Цель задаётся на главной клиента: ячейка «ручная корректировка» принимает число (22) или диапазон (22-30)."],
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
export function NutritionCalcScreen({ clientId, body, onUpdateBody, onOpenJournal, calc, measurements }: Readonly<{ clientId: string; body: CalcClientBody; onOpenJournal: () => void;
  /** Записывает пол и рост в карточку клиента (владелец данных — Clients). */
  onUpdateBody: (patch: Readonly<{ sex: CalcSex | null; heightCm: number | null }>) => Promise<void>; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { loaded, failed, reload } = useCalcData(clientId, calc, measurements);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [navyOpen, setNavyOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Замок от двойного нажатия: state `busy` обновляется асинхронно, ref — сразу. */
  const lock = useRef(false);

  const profile = loaded?.stored?.profile ?? DEFAULT_CALC_PROFILE;
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
    try { await calc.saveProfile(clientId, { ...profile, goal }, loaded.stored?.revision ?? null); setError(null); } catch (failure) { setError(calcErrorText(failure)); reload(); }
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
      if (weight !== null && weight !== loaded.weight) await upsertDailyMeasurement(measurements, clientId, { type: "WEIGHT", valueX10: Math.round(weight * 10), localDate: today, localMinute: null });
      if (fat !== null && fat !== loaded.fat) await upsertDailyMeasurement(measurements, clientId, { type: "BODY_FAT", valueX10: Math.round(fat * 10), localDate: today, localMinute: null });
      setEditing(false);
      setError(null);
    } catch (failure) { setError(calcErrorText(failure)); reload(); }
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
      <AppButton compact size="small" variant="secondary" label="?" accessibilityLabel="Справка по расчёту" onPress={() => setHelp(true)} />
      {editing ? <AppButton compact size="small" label="Готово" busy={busy} onPress={() => { void done(); }} />
        : <AppButton compact size="small" variant="secondary" label="Изменить" disabled={busy} onPress={startEdit} />}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}
      <Card title={editing ? "ПРОФИЛЬ И АКТИВНОСТЬ" : "РАСЧЁТ"} right={headerButtons}>
        {editing && draft !== null ? <>
          <View style={styles.pair}>
            <View style={styles.grow}><Stat label="СТАРТОВЫЙ РАСХОД" value={result.startTdee} caption="REE + NEAT + EAT" /></View>
            <View style={styles.grow}><Stat label="ИТОГОВЫЙ КАЛОРАЖ" value={result.target} caption={goalLabels[profile.goal]} accent /></View>
          </View>
          <ChoiceSegments label="Пол" items={[{ id: "MALE", label: "Мужской" }, { id: "FEMALE", label: "Женский" }]}
            value={draft.sex ?? ""} disabled={busy} onChange={(sex) => { if (sex === "MALE" || sex === "FEMALE") setField({ sex }); }} />
          <View style={styles.pair}>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Рост, см" value={draft.height} onChangeText={(height) => setField({ height })} keyboardType="decimal-pad" placeholder="—" /></View>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Вес, кг" value={draft.weight} onChangeText={(weight) => setField({ weight })} keyboardType="decimal-pad" placeholder="—" /></View>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Жир, %" value={draft.fat} onChangeText={(fat) => setField({ fat })} keyboardType="decimal-pad" placeholder="—" /></View>
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{body.age === null ? "Возраст: укажите дату рождения в карточке." : `Возраст: ${body.age} ${plural(body.age, "год", "года", "лет")} · из карточки клиента.`} Вес и жир сохраняются в замеры.</Text>

          <View style={[styles.nested, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            <View style={styles.nestedHead}>
              <Text style={[styles.nestedTitle, { color: colors.textPrimary }]}>Жир по обхватам · ВМС</Text>
              <AppButton compact size="small" disabled={busy} variant={navyOpen ? "secondary" : "ghost"} label={navyOpen ? "Свернуть" : "Развернуть"} accessibilityLabel={navyOpen ? "Свернуть калькулятор процента жира" : "Развернуть калькулятор процента жира"}
                onPress={() => setNavyOpen(!navyOpen)} />
            </View>
            {navyOpen ? <>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
              {draft.sex === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Выберите пол — формула для мужчин и женщин разная.</Text> : null}
              {num(draft.height) === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Рост берётся из поля «Рост» профиля выше.</Text> : null}
              <View style={styles.pair}>
                <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Шея, см" value={draft.neck} onChangeText={(neck) => setField({ neck })} keyboardType="decimal-pad" placeholder="0" /></View>
                <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Талия, см" value={draft.waist} onChangeText={(waist) => setField({ waist })} keyboardType="decimal-pad" placeholder="0" /></View>
                {draft.sex === "FEMALE" ? <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Бёдра, см" value={draft.hips} onChangeText={(hips) => setField({ hips })} keyboardType="decimal-pad" placeholder="0" /></View> : null}
              </View>
              <View style={styles.resultRow}>
                <View accessible accessibilityLabel={`Оценка жира: ${navy === null ? "нет данных" : `${navy} процентов`}`}>
                  <Text style={[styles.resultValue, { color: colors.textPrimary }]}>{navy === null ? "— %" : `${String(navy).replace(".", ",")} %`}</Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]}>Оценка по окружностям</Text>
                </View>
                <AppButton compact size="small" label="Подставить" accessibilityLabel="Подставить процент жира в профиль" disabled={navy === null || busy}
                  disabledReason="Введите пол, рост, шею и талию (женщинам — и бёдра)." onPress={() => { if (navy !== null) setField({ fat: show(navy) }); }} />
              </View>
            </> : null}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Образ жизни</Text>
          <ChoiceSegments label="Образ жизни" items={CALC_ACTIVITIES.map((id) => ({ id, label: activityLabels[id] }))}
            value={draft.activity} disabled={busy} onChange={(activity) => setField({ activity })} />
          <View style={styles.pair}>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Трен./нед." value={draft.workouts} onChangeText={(workouts) => setField({ workouts })} keyboardType="decimal-pad" placeholder="0" /></View>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Мин./трен." value={draft.minutes} onChangeText={(minutes) => setField({ minutes })} keyboardType="decimal-pad" placeholder="60" /></View>
            <View style={styles.grow}><TextField compact disabled={busy} textAlign="center" label="Шаг цели, ккал" value={draft.step} onChangeText={(step) => setField({ step })} keyboardType="decimal-pad" placeholder="100" /></View>
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>Шаг цели — поправка калорий для похудения и набора.</Text>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Интенсивность тренировок</Text>
          <ChoiceSegments label="Интенсивность тренировок" items={CALC_INTENSITIES.map((id) => ({ id, label: intensityLabels[id] }))}
            value={draft.intensity} disabled={busy} onChange={(intensity) => setField({ intensity })} />
        </> : <>
          <View style={styles.cols}>
            <View style={styles.leftCol}>
              <Stat label="СТАРТОВЫЙ РАСХОД" value={result.startTdee} caption="REE + NEAT + EAT" />
              <Stat label="ИТОГОВЫЙ КАЛОРАЖ" value={result.target} caption="" accent />
            </View>
            <View style={[styles.goalCard, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>ЦЕЛЬ</Text>
              {CALC_GOALS.map((id) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: profile.goal === id, disabled: busy }}
                accessibilityLabel={`Цель: ${goalLabels[id]}`} disabled={busy} onPress={() => { void selectGoal(id); }}
                style={({ pressed }) => [styles.goalButton, { backgroundColor: profile.goal === id ? colors.accentFill : colors.surface,
                  borderColor: profile.goal === id ? colors.accentFill : colors.border, opacity: busy ? 0.5 : pressed ? 0.75 : 1 }]}>
                <Text style={[styles.goalText, { color: profile.goal === id ? colors.onAccentFill : colors.textSecondary }]}>{goalLabels[id]}</Text>
              </Pressable>)}
            </View>
          </View>
          <View style={[styles.strip, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            {([["REE", result.ree, "базовый обмен"], ["NEAT", result.neat, result.neatSource === "STEPS" ? "по шагам" : "по образу жизни"], ["EAT", result.eat, "по тренировкам"]] as const).map(([title, value, caption], index) => (
              <View key={title} accessible accessibilityLabel={`${title}: ${value === null ? "нет данных" : value}, ${caption}`} style={[styles.stripCell, index > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : null]}>
                <Text style={[styles.statLabel, { color: colors.charts[index]! }]}>{title}</Text>
                <Text style={[styles.stripValue, { color: colors.textPrimary }]}>{value === null ? "—" : String(value)}</Text>
                <Text style={[styles.statCaption, { color: colors.textMuted }]}>{caption}</Text>
              </View>
            ))}
          </View>
          {missing ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Для расчёта нужны пол, возраст, рост и вес (или вес с процентом жира). Нажмите «Изменить», чтобы заполнить профиль.</Text> : null}
        </>}
      </Card>


      <MeasurementsCard compact clientId={clientId} repository={measurements} onOpenJournal={onOpenJournal} />

      <HelpSheet visible={help} onClose={() => setHelp(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, gap: 8 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1, minWidth: 0 },
  card: { ...shadow.card, borderRadius: 20, padding: 8, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
  headButtons: { flexDirection: "row", gap: 8, alignItems: "center" },
  cols: { flexDirection: "row", gap: 6, alignItems: "stretch" },
  leftCol: { flex: 1.2, minWidth: 0, gap: 6 },
  stat: { borderRadius: 14, borderWidth: 1, padding: 8, gap: 1 },
  statLabel: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13, letterSpacing: 0.2 },
  statValue: { fontFamily: fonts.bold, fontSize: 23, lineHeight: 28 },
  goalCard: { flex: 1, minWidth: 0, borderRadius: 14, borderWidth: 1, padding: 6, gap: 4, justifyContent: "center" },
  goalButton: { minHeight: 32, borderRadius: 12, borderWidth: 1, paddingHorizontal: 4, justifyContent: "center", alignItems: "center" },
  goalText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, textAlign: "center" },
  strip: { flexDirection: "row", borderRadius: 18, borderWidth: 1 },
  stripCell: { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 2, gap: 1 },
  stripValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  statCaption: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13, textAlign: "center" },
  hint: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  hintBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pair: { flexDirection: "row", gap: 6 },
  nested: { borderRadius: 14, borderWidth: 1, padding: 8, gap: 6 },
  nestedHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  nestedTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
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
