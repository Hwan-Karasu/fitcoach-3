import { useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { MEAL_SLOTS, type DiaryEntry, type MealSlot } from "../domain/DiaryModel.ts";
import { effectiveNutrients } from "../domain/DiaryRules.ts";
import { kcalFromMacrosX10 } from "../domain/EnergyRules.ts";
import { planOverride, type FieldEdits } from "../domain/EntryEditRules.ts";
import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from "../domain/FoodModel.ts";
import { formatDecimalX10, parseDecimalX10, scaleNutrients } from "../domain/FoodRules.ts";
import { slotLabels, unitLabels } from "./nutritionFormat.ts";

const labels: Readonly<Record<NutrientKey, string>> = { kcalX10: "Калории, ккал", proteinX10: "Белки, г", fatX10: "Жиры, г", carbsX10: "Углеводы, г" };
type Texts = Readonly<Record<NutrientKey, string>>;
type Touched = Readonly<Record<NutrientKey, boolean>>;
const NONE_TOUCHED: Touched = { kcalX10: false, proteinX10: false, fatX10: false, carbsX10: false };
const EMPTY_TEXTS: Texts = { kcalX10: "", proteinX10: "", fatX10: "", carbsX10: "" };
const show = (value: number | null) => value === null ? "" : formatDecimalX10(value);

/**
 * Редактор добавленной записи (UX v1.1, NUT-FS-27…34): количество, приём пищи, К/Б/Ж/У **этой порции**, «Сохранить», «Удалить». Правка пищевой ценности относится только к этой записи:
 * каталог, снимок продукта, соседние записи и другие клиенты не меняются; при смене массы правка масштабируется пропорционально. Калории считаются сами из Б/Ж/У (1 г = 4 / 9 / 4 ккал),
 * пока не введены вручную. «Вернуть значения каталога» снимает правку.
 */
export function EntryEditorDialog({ entry, onClose, onSave, onRemove }: Readonly<{ entry: DiaryEntry | null; onClose: () => void;
  onSave: (entry: DiaryEntry, quantityX10: number, slot: MealSlot, override: Nutrients | "CLEAR" | null) => Promise<string | null>; onRemove: (entry: DiaryEntry) => Promise<string | null> }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [shownId, setShownId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [slot, setSlot] = useState<MealSlot>("BREAKFAST");
  const [fields, setFields] = useState<Texts>(EMPTY_TEXTS);
  const [touched, setTouched] = useState<Touched>(NONE_TOUCHED);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (entry === null && shownId !== null) setShownId(null);
  if (entry !== null && shownId !== entry.id) {
    setShownId(entry.id); setText(formatDecimalX10(entry.snapshot.quantityX10)); setSlot(entry.slot); setFields(EMPTY_TEXTS); setTouched(NONE_TOUCHED); setConfirmRemove(false); setError(null);
  }

  const parsedQuantity = parseDecimalX10(text);
  const quantity = parsedQuantity !== null && parsedQuantity > 0 ? parsedQuantity : (entry?.snapshot.quantityX10 ?? 10);
  /** Действующие значения при введённом количестве: по каталогу, с учётом прежней правки записи (масштабируется). */
  const effective = useMemo<Nutrients | null>(() => {
    if (entry === null) return null;
    const { basis, perBasis } = entry.snapshot;
    try { return effectiveNutrients(scaleNutrients({ ...basis, ...perBasis }, quantity), entry.override ?? null, quantity); } catch { return entry.snapshot.eaten; }
  }, [entry, quantity]);

  const macrosTouched = touched.proteinX10 || touched.fatX10 || touched.carbsX10;
  const valueOf = (key: NutrientKey): string => touched[key] ? fields[key] : show(effective === null ? null : effective[key]);
  /** Калории считаются сами, пока тренер правит Б/Ж/У и не вводил калории вручную. */
  const autoKcal = !touched.kcalX10 && macrosTouched
    ? kcalFromMacrosX10({ proteinX10: parseDecimalX10(valueOf("proteinX10")), fatX10: parseDecimalX10(valueOf("fatX10")), carbsX10: parseDecimalX10(valueOf("carbsX10")) }) : null;
  const shownText = (key: NutrientKey) => key === "kcalX10" && autoKcal !== null ? show(autoKcal) : valueOf(key);
  const changed = entry !== null && (macrosTouched || touched.kcalX10 || entry.override != null);

  const edit = (key: NutrientKey, value: string) => { setFields({ ...fields, [key]: value }); setTouched({ ...touched, [key]: true }); setError(null); };
  const revertToCatalog = () => {
    if (entry === null) return;
    setFields(EMPTY_TEXTS);
    // Все ранее правленные показатели помечаются тронутыми и пустыми — `planOverride` вернёт «CLEAR».
    setTouched({ kcalX10: entry.override?.values.kcalX10 != null, proteinX10: entry.override?.values.proteinX10 != null, fatX10: entry.override?.values.fatX10 != null, carbsX10: entry.override?.values.carbsX10 != null });
    setError(null);
  };

  const run = async (work: () => Promise<string | null>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { const message = await work(); if (message === null) onClose(); else setError(message); }
    catch { setError("Не удалось сохранить запись. Повторите действие."); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => {
    if (entry === null) return;
    if (parsedQuantity === null || parsedQuantity <= 0) { setError("Введите количество, например 150 или 1,5."); return; }
    const edits = {} as Record<NutrientKey, { touched: boolean; valueX10: number | null }>;
    for (const key of NUTRIENT_KEYS) {
      const isTouched = touched[key] || (key === "kcalX10" && autoKcal !== null);
      const raw = key === "kcalX10" && autoKcal !== null ? show(autoKcal) : fields[key];
      if (isTouched && raw.trim() !== "" && parseDecimalX10(raw) === null) { setError(`${labels[key].split(",")[0]}: число не более чем с одним знаком после запятой, например 12,5.`); return; }
      edits[key] = { touched: isTouched, valueX10: isTouched && raw.trim() !== "" ? parseDecimalX10(raw) : null };
    }
    let override: Nutrients | "CLEAR" | null;
    try { override = planOverride(entry, parsedQuantity, edits as FieldEdits); } catch { setError("Не удалось разобрать значения."); return; }
    void run(() => onSave(entry, parsedQuantity, slot, override));
  };
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={() => { if (!lock.current) onClose(); }}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{entry?.snapshot.name ?? ""}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry === null ? "" : entry.localDate}</Text>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextField label={`Количество, ${entry === null ? "" : unitLabels[entry.snapshot.basis.unit]}`} value={text} onChangeText={(next) => { setText(next); setError(null); }} keyboardType="decimal-pad"
              error={error ?? undefined} />
            <Text style={[styles.meta, { color: colors.textSecondary }]}>Приём пищи</Text>
            <View style={styles.chips}>
              {MEAL_SLOTS.map((id) => <SelectionChip key={id} group="Приём пищи" label={slotLabels[id]} selected={slot === id} disabled={busy} onPress={() => setSlot(id)} />)}
            </View>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>Пищевая ценность этой порции</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>Меняется только эта запись: каталог, другие записи и клиенты не затрагиваются. При смене массы правка масштабируется пропорционально.</Text>
            {changed ? <Text style={[styles.meta, { color: colors.accentInk }]}>Питательность изменена для этой записи</Text> : null}
            <TextField label={autoKcal !== null ? "Калории, ккал (авто из Б/Ж/У)" : labels.kcalX10} value={shownText("kcalX10")} keyboardType="decimal-pad" disabled={busy}
              hint="1 г белка = 4 ккал, жира = 9, углеводов = 4. Можно ввести своё число — оно заменит авторасчёт." onChangeText={(value) => edit("kcalX10", value)} />
            <View style={styles.row}>
              {(["proteinX10", "fatX10", "carbsX10"] as const).map((key) => (
                <View key={key} style={styles.cell}>
                  <TextField label={labels[key]} value={shownText(key)} keyboardType="decimal-pad" disabled={busy} onChangeText={(value) => edit(key, value)} />
                </View>
              ))}
            </View>
            {entry?.override != null ? <AppButton compact variant="secondary" label="Вернуть значения каталога" disabled={busy} onPress={revertToCatalog} /> : null}
          </ScrollView>
          <AppButton label="Сохранить" onPress={save} busy={busy} />
          {confirmRemove ? <>
            <Text style={[styles.meta, { color: colors.danger }]}>Запись будет удалена из дневника. Итоги дня пересчитаются.</Text>
            <AppButton variant="destructive" label="Подтвердить удаление" disabled={busy} onPress={() => { if (entry !== null) void run(() => onRemove(entry)); }} />
          </> : <AppButton variant="destructive" label="Удалить запись" disabled={busy} onPress={() => setConfirmRemove(true)} />}
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10, maxHeight: "94%" },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  heading: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  body: { gap: 10 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1 },
});
