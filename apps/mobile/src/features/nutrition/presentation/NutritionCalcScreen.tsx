import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { plural } from "../../../shared/format/clockText.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { scrim } from "../../../shared/ui/theme/style.ts";
import { BODY_FAT_PICTURES, BodyFatPictureSheet, localDateOf, navyBodyFat, pictureSetOf, upsertDailyMeasurement, type MeasurementRepositoryPort,
  type WritableMeasurementMethod } from "../../measurements/public.ts";
import { CALC_ACTIVITIES, CALC_GOALS, CALC_INTENSITIES, deriveCalc, type CalcActivity, type CalcGoal, type CalcIntensity,
  type CalcProfile, type CalcSex } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import { DEFAULT_CALC_PROFILE, useCalcData } from "./useCalcData.ts";
import { nutritionErrorText } from "./nutritionFormat.ts";
import { LinkTile, OptionGrid, PillSegments, ProfileField, SheetLabel, SoftPill } from "./CalcSheetParts.tsx";

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
  /** Как получен процент жира в поле: вручную/по обхватам — MANUAL; выбран рисунок — VISUAL_ESTIMATE и его номер (UIX-06). */
  fatMethod: WritableMeasurementMethod; fatPicture: number | null;
}

function draftOf(profile: CalcProfile, body: CalcClientBody, weight: number | null, fat: number | null): Draft {
  return { sex: body.sex, height: show(body.heightCm), weight: show(weight), fat: show(fat), activity: profile.activity, workouts: String(profile.workoutsPerWeek),
    minutes: String(profile.minutes), step: String(profile.stepKcal), intensity: profile.intensity, neck: "", waist: "", hips: "", fatMethod: "MANUAL", fatPicture: null };
}

function profileOf(draft: Draft, goal: CalcGoal): CalcProfile {
  const whole = (text: string, fallback: number) => text.trim() === "" ? fallback : (num(text) ?? Number.NaN);
  return { goal, activity: draft.activity,
    workoutsPerWeek: whole(draft.workouts, 0), minutes: whole(draft.minutes, 60), intensity: draft.intensity, stepKcal: whole(draft.step, 100) };
}

function calcErrorText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "CALC_PROFILE_INVALID": return "Проверьте поля: тренировок 0–21 в неделю, минут 1–600, шаг цели 0–1000 ккал.";
    case "CALC_STALE": return "Профиль уже изменился. Данные обновлены — повторите действие.";
    case "MEASUREMENT_VALUE_INVALID": return "Вес и процент жира вне допустимого диапазона.";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_AMBIGUOUS_DAY": return "За сегодня несколько записей веса или % жира. Выберите основную в журнале замеров и повторите.";
    default: return nutritionErrorText(error);
  }
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
 * Экран «Расчёт» (§49.10, UX «Расчёт»; вид — макет листов «Расчёт» и «Профиль и активность»): просмотр и редактирование — состояния одного листа; вес и % жира берутся
 * из Measurements, шаги — из суточной активности. Результат — справочная оценка: цели он не меняет (ADR-025/027), цель задаётся на главной клиента.
 */
/** Профиль расчёта вместе с полом и ростом карточки клиента (`null` — карточку не менять): одна операция workflow, пол и рост принадлежат Clients. */
export type SaveCalcProfile = (profile: CalcProfile, expectedRevision: number | null, body: Readonly<{ sex: CalcSex | null; heightCm: number | null }> | null) => Promise<void>;

export function NutritionCalcScreen({ clientId, body, onSaveProfile, calc, measurements, onEditingChange }: Readonly<{ clientId: string; body: CalcClientBody;
  onSaveProfile: SaveCalcProfile; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort;
  /** Оболочка листа меняет заголовок: «Расчёт» ↔ «Профиль и активность». */
  onEditingChange?: (editing: boolean) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { loaded, failed, reload } = useCalcData(clientId, calc, measurements);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [girthOpen, setGirthOpen] = useState(false);
  const [pictureOpen, setPictureOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Замок от двойного нажатия: state `busy` обновляется асинхронно, ref — сразу. */
  const lock = useRef(false);
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

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
    setGirthOpen(false);
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
    // Профиль с полом и ростом — одна операция; вес и % жира — отдельные факты Measurements (новая запись только при изменении): сбой одного не мешает остальным.
    const failures: string[] = [];
    const heightCm = draft.height.trim() === "" ? null : num(draft.height);
    try { await onSaveProfile(next, loaded.stored?.revision ?? null, draft.sex !== body.sex || heightCm !== body.heightCm ? { sex: draft.sex, heightCm } : null); }
    catch (failure) { failures.push(calcErrorText(failure)); }
    const today = localDateOf(new Date());
    if (weight !== null && weight !== loaded.weight) {
      try { await upsertDailyMeasurement(measurements, clientId, { type: "WEIGHT", valueX100: Math.round(weight * 100), localDate: today, localMinute: null }); }
      catch (failure) { failures.push(`Вес: ${calcErrorText(failure)}`); }
    }
    if (fat !== null && (fat !== loaded.fat || draft.fatMethod === "VISUAL_ESTIMATE")) {
      try { await upsertDailyMeasurement(measurements, clientId, { type: "BODY_FAT", valueX100: Math.round(fat * 10) * 10, localDate: today, localMinute: null, method: draft.fatMethod }); }
      catch (failure) { failures.push(`% жира: ${calcErrorText(failure)}`); }
    }
    if (failures.length === 0) { setEditing(false); setError(null); } else { setError(failures.join(" ")); reload(); }
    lock.current = false;
    setBusy(false);
  };

  if (loaded === null || result === null || live === null) {
    return failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить расчёт.</InlineNotice></View> : <LoadingState label="Загружаем расчёт…" />;
  }
  const missing = result.startTdee === null;
  const pictureSet = draft === null ? null : pictureSetOf(draft.sex);
  const pickedPicture = draft === null || pictureSet === null || draft.fatPicture === null ? null : BODY_FAT_PICTURES[pictureSet].find((entry) => entry.index === draft.fatPicture) ?? null;
  const setField = (patch: Partial<Draft>) => setDraft((current) => current === null ? current : { ...current, ...patch });
  const parts = [
    { key: "REE", name: "Базовый обмен · REE", value: result.ree, color: colors.charts[0]! },
    { key: "NEAT", name: "Шаги и быт · NEAT", value: result.neat, color: colors.charts[1]! },
    { key: "EAT", name: "Тренировки · EAT", value: result.eat, color: colors.charts[2]! },
  ] as const;
  const stepNote = result.startTdee === null ? null : profile.goal === "LOSS" ? ` − шаг цели ${profile.stepKcal}` : profile.goal === "GAIN" ? ` + шаг цели ${profile.stepKcal}` : "";

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}
      {editing && draft !== null ? <>
        <PillSegments label="Пол" height={38} items={[{ id: "MALE", label: "Мужской" }, { id: "FEMALE", label: "Женский" }]} value={draft.sex ?? ""} disabled={busy}
          onChange={(sex) => setField(sex === draft.sex ? { sex } : { sex, fatPicture: null, fatMethod: "MANUAL" })} />
        <View style={styles.row}>
          <ProfileField label="Рост, см" disabled={busy} value={draft.height} onChangeText={(height) => setField({ height })} placeholder="—" />
          <ProfileField label="Вес, кг" disabled={busy} value={draft.weight} onChangeText={(weight) => setField({ weight })} placeholder="—" />
          <ProfileField label="Жир, %" disabled={busy} value={draft.fat} onChangeText={(fat) => setField({ fat, fatMethod: "MANUAL", fatPicture: null })} placeholder="—" />
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{body.age === null ? "Возраст: укажите дату рождения в карточке." : `Возраст: ${body.age} ${plural(body.age, "год", "года", "лет")} · из карточки клиента.`} Вес и жир сохраняются в замеры.</Text>

        <SheetLabel>Как определить процент жира</SheetLabel>
        <View style={styles.row}>
          <LinkTile label="По обхватам" disabled={busy} accessibilityHint="Показать поля шеи, талии и бёдер" onPress={() => setGirthOpen(!girthOpen)} />
          <LinkTile label="По рисунку" disabled={busy || pictureSet === null} accessibilityHint={pictureSet === null ? "Сначала выберите пол" : "Открыть рисунки для оценки процента жира"} onPress={() => setPictureOpen(true)} />
        </View>
        {pictureSet === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Выберите пол — формулы и наборы рисунков для мужчин и женщин разные.</Text> : null}
        {pickedPicture !== null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Выбран рисунок: ${pickedPicture.label} %. Ориентировочно, не заменяет замеры.`}</Text> : null}
        {girthOpen ? <>
          <View style={styles.row}>
            <ProfileField label="Шея, см" disabled={busy} value={draft.neck} onChangeText={(neck) => setField({ neck })} placeholder="0" />
            <ProfileField label="Талия, см" disabled={busy} value={draft.waist} onChangeText={(waist) => setField({ waist })} placeholder="0" />
            {draft.sex === "FEMALE" ? <ProfileField label="Бёдра, см" disabled={busy} value={draft.hips} onChangeText={(hips) => setField({ hips })} placeholder="0" /> : null}
          </View>
          {num(draft.height) === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Рост берётся из поля «Рост» профиля выше.</Text> : null}
          <View style={styles.resultRow}>
            <View accessible accessibilityLabel={`Оценка жира: ${navy === null ? "нет данных" : `${navy} процентов`}`}>
              <Text style={[styles.resultValue, { color: colors.textPrimary }]}>{navy === null ? "— %" : `${String(navy).replace(".", ",")} %`}</Text>
              <Text style={[styles.hint, { color: colors.textMuted }]}>Оценка по окружностям</Text>
            </View>
            <AppButton compact size="small" label="Подставить" accessibilityLabel="Подставить процент жира в профиль" disabled={navy === null || busy}
              disabledReason="Введите пол, рост, шею и талию (женщинам — и бёдра)." onPress={() => { if (navy !== null) setField({ fat: show(navy), fatMethod: "MANUAL", fatPicture: null }); }} />
          </View>
        </> : null}

        <SheetLabel>Образ жизни</SheetLabel>
        <OptionGrid label="Образ жизни" columns={2} items={CALC_ACTIVITIES.map((id) => ({ id, label: activityLabels[id] }))} value={draft.activity} disabled={busy}
          onChange={(activity) => setField({ activity })} />
        <View style={styles.row}>
          <ProfileField label="Трен./нед." disabled={busy} value={draft.workouts} onChangeText={(workouts) => setField({ workouts })} placeholder="0" />
          <ProfileField label="Мин./трен." disabled={busy} value={draft.minutes} onChangeText={(minutes) => setField({ minutes })} placeholder="60" />
          <ProfileField label="Шаг цели, ккал" disabled={busy} value={draft.step} onChangeText={(step) => setField({ step })} placeholder="100" />
        </View>
        <SheetLabel>Интенсивность тренировок</SheetLabel>
        <OptionGrid label="Интенсивность тренировок" columns={3} items={CALC_INTENSITIES.map((id) => ({ id, label: intensityLabels[id] }))} value={draft.intensity} disabled={busy}
          onChange={(intensity) => setField({ intensity })} />
        <View style={styles.cta}><AppButton label="Готово" busy={busy} onPress={() => { void done(); }} /></View>
      </> : <>
        <View accessible accessibilityLabel={`Итоговый калораж: ${result.target === null ? "нет данных" : `${result.target} ккал в день`}`} style={styles.center}>
          <Text style={[styles.big, { color: colors.textPrimary }]}>{result.target === null ? "—" : String(result.target)}<Text style={[styles.bigUnit, { color: colors.textSecondary }]}>{result.target === null ? "" : " ккал в день"}</Text></Text>
          <Text style={[styles.hint12, { color: colors.textSecondary }]}>{result.startTdee === null ? "Нужны пол, возраст, рост и вес" : `Стартовый расход ${result.startTdee}${stepNote ?? ""}`}</Text>
        </View>
        <PillSegments label="Цель" items={CALC_GOALS.map((id) => ({ id, label: goalLabels[id] }))} value={profile.goal} disabled={busy} onChange={(goal) => { void selectGoal(goal); }} />
        <SheetLabel>Из чего складывается расход</SheetLabel>
        <View accessible accessibilityLabel={`Расход: ${parts.map((part) => `${part.key} ${part.value ?? "нет данных"}`).join(", ")}`} style={[styles.bar, { backgroundColor: colors.border }]}>
          {parts.map((part) => (part.value === null || part.value <= 0 ? null : <View key={part.key} style={{ flex: part.value, backgroundColor: part.color }} />))}
        </View>
        {parts.map((part) => (
          <View key={part.key} accessible accessibilityLabel={`${part.name}: ${part.value === null ? "нет данных" : part.value}${part.key === "NEAT" ? `, ${result.neatSource === "STEPS" ? "по шагам" : "по образу жизни"}` : ""}`} style={styles.partRow}>
            <View style={styles.partName}>
              <View style={[styles.dot, { backgroundColor: part.color }]} />
              <Text style={[styles.partText, { color: colors.textPrimary }]}>{part.name}</Text>
            </View>
            <Text style={[styles.partValue, { color: colors.textPrimary }]}>{part.value === null ? "—" : String(part.value)}</Text>
          </View>
        ))}
        {missing ? <Text style={[styles.hint12, { color: colors.textSecondary }]}>Для расчёта нужны пол, возраст, рост и вес (или вес с процентом жира). Откройте «Профиль и активность» и заполните данные.</Text> : null}
        <View style={styles.cta}><SoftPill label="Профиль и активность" disabled={busy} onPress={startEdit} /></View>
        <Text style={[styles.hint, styles.hintCenter, { color: colors.textSecondary }]}>Расчёт справочный: цель по БЖУ задаётся полями на «Главной».</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Справка по расчёту" hitSlop={{ top: 14, bottom: 14 }} onPress={() => setHelp(true)} style={styles.helpLink}>
          <Text style={[styles.helpLinkText, { color: colors.accentInk }]}>Как считается расчёт</Text>
        </Pressable>
      </>}

      {pictureSet === null ? null : <BodyFatPictureSheet visible={pictureOpen} set={pictureSet} selected={draft?.fatPicture ?? null} onClose={() => setPictureOpen(false)}
        onSelect={(picture) => { setField({ fat: show(picture.pickX10 / 10), fatMethod: "VISUAL_ESTIMATE", fatPicture: picture.index }); setPictureOpen(false); }} />}
      <HelpSheet visible={help} onClose={() => setHelp(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 8 },
  pad: { paddingHorizontal: 16 },
  row: { flexDirection: "row", gap: 6 },
  center: { alignItems: "center", gap: 2, marginBottom: 2 },
  big: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 46, fontVariant: ["tabular-nums"] },
  bigUnit: { fontFamily: fonts.bold, fontSize: 14 },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  hint12: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center" },
  hintCenter: { textAlign: "center", marginHorizontal: 8 },
  bar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2 },
  partRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 3 },
  partName: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  partText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  partValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, fontVariant: ["tabular-nums"] },
  cta: { marginTop: 6 },
  helpLink: { alignSelf: "center", minHeight: 20, justifyContent: "center" },
  helpLinkText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  resultValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: scrim },
  dialog: { borderRadius: 24, padding: 18, gap: 10, maxHeight: "90%" },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  dialogBody: { gap: 12 },
  helpItem: { gap: 2 },
  hintBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  helpTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
