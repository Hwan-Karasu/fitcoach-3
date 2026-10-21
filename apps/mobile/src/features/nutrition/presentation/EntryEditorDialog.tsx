import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pencil } from "lucide-react-native";
import { AppButton, AppIconButton, TextField } from "../../../shared/ui/components/public.ts";
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
export function EntryEditorDialog({ entry, onClose, onSave, onRemove, onEditSource }: Readonly<{ entry: DiaryEntry | null; onClose: () => void;
  /** `extraSlots` — приёмы того же дня, куда дополнительно сохраняются копии записи. */
  onSave: (entry: DiaryEntry, quantityX10: number, slot: MealSlot, override: Nutrients | "CLEAR" | null, extraSlots: readonly MealSlot[]) => Promise<string | null>;
  onRemove: (entry: DiaryEntry) => Promise<string | null>;
  /** Карандаш в шапке: открыть продукт или рецепт в каталоге. */
  onEditSource?: (entry: DiaryEntry) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [shownId, setShownId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [slots, setSlots] = useState<readonly MealSlot[]>(["BREAKFAST"]);
  const [fields, setFields] = useState<Texts>(EMPTY_TEXTS);
  const [touched, setTouched] = useState<Touched>(NONE_TOUCHED);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (entry === null && shownId !== null) setShownId(null);
  if (entry !== null && shownId !== entry.id) {
    setShownId(entry.id); setText(formatDecimalX10(entry.snapshot.quantityX10)); setSlots([entry.slot]); setFields(EMPTY_TEXTS); setTouched(NONE_TOUCHED); setConfirmRemove(false); setError(null);
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

  const toggleSlot = (id: MealSlot) => setSlots((current) => current.includes(id) ? (current.length === 1 ? current : current.filter((value) => value !== id)) : [...current, id]);
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
    // Запись остаётся в своём приёме, если он выбран; иначе переезжает в первый выбранный. Остальные выбранные приёмы получают копии.
    const target = slots.includes(entry.slot) ? entry.slot : (MEAL_SLOTS.find((id) => slots.includes(id)) ?? entry.slot);
    void run(() => onSave(entry, parsedQuantity, target, override, MEAL_SLOTS.filter((id) => slots.includes(id) && id !== target)));
  };
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={() => { if (!lock.current) onClose(); }}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{entry?.snapshot.name ?? ""}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry === null ? "" : entry.localDate}</Text>
            </View>
            {onEditSource !== undefined && entry !== null ? <AppIconButton compact label={entry.snapshot.source.kind === "FOOD" ? "Изменить продукт в каталоге" : "Изменить рецепт в каталоге"}
              icon={<Pencil size={20} color={colors.textPrimary} />} onPress={() => onEditSource(entry)} /> : null}
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextField label={`Количество, ${entry === null ? "" : unitLabels[entry.snapshot.basis.unit]}`} value={text} onChangeText={(next) => { setText(next); setError(null); }} keyboardType="decimal-pad"
              error={error ?? undefined} />
            <View accessibilityLabel="Приём пищи" style={styles.slotRow}>
              {MEAL_SLOTS.map((id) => {
                const selected = slots.includes(id);
                return <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} accessibilityLabel={slotLabels[id]} disabled={busy} onPress={() => toggleSlot(id)}
                  style={[styles.slotPill, { backgroundColor: selected ? colors.accentFill : colors.surfaceRaised, borderColor: selected ? colors.accentFill : colors.border }]}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.slotText, { color: selected ? colors.onAccentFill : colors.textPrimary }]}>{slotLabels[id]}</Text>
                </Pressable>;
              })}
            </View>
            {changed ? <Text style={[styles.meta, { color: colors.accentInk }]}>Питательность изменена для этой записи</Text> : null}
            <View style={styles.row}>
              {(["proteinX10", "fatX10", "carbsX10"] as const).map((key) => (
                <View key={key} style={styles.cell}>
                  <TextField label={labels[key]} value={shownText(key)} keyboardType="decimal-pad" disabled={busy} onChangeText={(value) => edit(key, value)} />
                </View>
              ))}
            </View>
            <TextField label={autoKcal !== null ? "Калории, ккал (авто)" : labels.kcalX10} value={shownText("kcalX10")} keyboardType="decimal-pad" disabled={busy} onChangeText={(value) => edit("kcalX10", value)} />
            {entry?.override != null ? <AppButton compact variant="secondary" label="Вернуть значения каталога" disabled={busy} onPress={revertToCatalog} /> : null}
          </ScrollView>
          {confirmRemove ? <>
            <Text style={[styles.meta, { color: colors.danger }]}>Запись будет удалена из дневника. Итоги дня пересчитаются.</Text>
            <View style={styles.row}>
              <View style={styles.cell}><AppButton variant="destructive" label="Подтвердить" accessibilityLabel="Подтвердить удаление записи" disabled={busy} onPress={() => { if (entry !== null) void run(() => onRemove(entry)); }} /></View>
              <View style={styles.cell}><AppButton variant="secondary" label="Не удалять" disabled={busy} onPress={() => setConfirmRemove(false)} /></View>
            </View>
          </> : <View style={styles.row}>
            <View style={styles.cell}><AppButton label="Сохранить" onPress={save} busy={busy} /></View>
            <View style={styles.cell}><AppButton variant="destructive" label="Удалить" accessibilityLabel="Удалить запись" disabled={busy} onPress={() => setConfirmRemove(true)} /></View>
          </View>}
          <AppButton compact variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10, maxHeight: "94%" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headText: { flex: 1, minWidth: 0 },
  slotRow: { flexDirection: "row", gap: 6 },
  slotPill: { flex: 1, minWidth: 0, minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  slotText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  heading: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  body: { gap: 10 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1 },
});
