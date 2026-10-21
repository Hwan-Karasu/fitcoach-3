import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, LoadingState, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { FoodBasisUnit, FoodProduct } from "../domain/FoodModel.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import { kcalFromMacrosX10 } from "../domain/EnergyRules.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import { nutritionErrorText } from "./nutritionFormat.ts";

const units: readonly Readonly<{ id: FoodBasisUnit; label: string; amount: string }>[] = [
  { id: "G", label: "на 100 г", amount: "100" }, { id: "ML", label: "на 100 мл", amount: "100" }, { id: "PORTION", label: "на порцию", amount: "1" },
];

/** Пустое поле — «не введено» (`null`), а не ноль; непустое некорректное — ошибка поля. */
function optionalValue(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  return parseDecimalX10(text) ?? "invalid";
}

/**
 * Новый собственный продукт (§49.3): название, марка, на какое количество даны значения, ккал и БЖУ. Значения, которые тренер не знает, остаются
 * пустыми и не превращаются в ноль. Каталог общий для всех клиентов.
 */
export function FoodEditorScreen({ foods, foodId, initialName = "", onSaved, onDirtyChange }: Readonly<{ foods: FoodCatalogPort; foodId?: string; initialName?: string; onSaved: (food: FoodProduct) => void; onDirtyChange?: (dirty: boolean) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
  const [pieceMass, setPieceMass] = useState("");
  const [unit, setUnit] = useState<FoodBasisUnit>("G");
  const [amount, setAmount] = useState("100");
  const [values, setValues] = useState({ kcal: "", protein: "", fat: "", carbs: "" });
  /** Калории считаются сами из Б/Ж/У (4/9/4), пока не введены вручную; очистка поля возвращает авторасчёт. */
  const [kcalManual, setKcalManual] = useState(false);
  const macro = (text: string) => text.trim() === "" ? null : parseDecimalX10(text);
  const autoKcalX10 = kcalFromMacrosX10({ proteinX10: macro(values.protein), fatX10: macro(values.fat), carbsX10: macro(values.carbs) });
  const kcalAuto = !kcalManual && autoKcalX10 !== null;
  const kcalText = kcalAuto ? formatDecimalX10(autoKcalX10) : values.kcal;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const lock = useRef(false);
  const [loaded, setLoaded] = useState(foodId === undefined);
  const [revision, setRevision] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [initialSignature, setInitialSignature] = useState<string | null>(null);
  const signature = JSON.stringify({ name, brand, barcode, pieceMass, unit, amount, values, kcalManual });
  useEffect(() => {
    if (loaded && initialSignature === null) setInitialSignature(signature);
    if (initialSignature !== null) onDirtyChange?.(signature !== initialSignature);
  }, [loaded, initialSignature, signature, onDirtyChange]);
  useEffect(() => {
    if (foodId === undefined) return;
    let active = true;
    void foods.get(foodId).then((food) => {
      if (!active) return;
      if (food === null) { setError("Продукт не найден."); setLoaded(true); return; }
      setName(food.name); setBrand(food.brand ?? ""); setBarcode(food.barcode ?? ""); setPieceMass(food.gramsPerPieceX10 == null ? "" : formatDecimalX10(food.gramsPerPieceX10));
      setUnit(food.unit); setAmount(formatDecimalX10(food.amountX10));
      const show = (value: number | null) => value === null ? "" : formatDecimalX10(value);
      setValues({ kcal: show(food.kcalX10), protein: show(food.proteinX10), fat: show(food.fatX10), carbs: show(food.carbsX10) });
      setKcalManual(food.kcalX10 !== null); setRevision(food.revision); setLoaded(true);
    }, () => { if (active) { setError("Не удалось загрузить продукт."); setLoaded(true); } });
    return () => { active = false; };
  }, [foodId, foods]);

  const save = async () => {
    if (lock.current) return;
    const amountX10 = parseDecimalX10(amount);
    const parsed = { kcalX10: optionalValue(kcalText), proteinX10: optionalValue(values.protein), fatX10: optionalValue(values.fat), carbsX10: optionalValue(values.carbs) };
    if (amountX10 === null || amountX10 <= 0) { setError("Укажите, на какое количество даны значения, например 100."); return; }
    const pieceX10 = optionalValue(pieceMass);
    if (pieceX10 === "invalid") { setError("Масса одной штуки — число, например 45."); return; }
    if (Object.values(parsed).includes("invalid")) { setError("Значения — числа не более чем с одним знаком после запятой, например 12,5."); return; }
    lock.current = true; setBusy(true);
    try {
      const input = { name, brand: brand.trim() === "" ? null : brand, unit, amountX10, barcode: barcode.trim() === "" ? null : barcode, gramsPerPieceX10: pieceX10, kcalX10: parsed.kcalX10 as number | null,
        proteinX10: parsed.proteinX10 as number | null, fatX10: parsed.fatX10 as number | null, carbsX10: parsed.carbsX10 as number | null };
      const created = foodId === undefined ? await foods.create(input) : await foods.update(foodId, revision, input);
      onDirtyChange?.(false);
      onSaved(created);
    } catch (failure) {
      setError(nutritionErrorText(failure));
      setBusy(false);
    } finally { lock.current = false; }
  };

  if (!loaded) return <LoadingState label="Загружаем продукт…" />;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <TextField label="Название" value={name} onChangeText={setName} required autoCapitalize="sentences" />
      <AppButton compact variant="ghost" label={details ? "Скрыть дополнительные поля" : "Марка, штрихкод и масса штуки"} onPress={() => setDetails(!details)} />
      {details ? <>
      <TextField label="Марка или описание" value={brand} onChangeText={setBrand} hint="Необязательно" />
      <TextField label="Штрихкод" value={barcode} onChangeText={setBarcode} hint="Необязательно. Только для локального поиска: сетевого справочника нет." />
      <TextField label="Масса одной штуки, г" value={pieceMass} onChangeText={setPieceMass} keyboardType="decimal-pad"
        hint="Необязательно. Если указать, при добавлении еды можно вводить штуки; без неё штуки недоступны." />
      </> : null}
      <Text style={[styles.label, { color: colors.textPrimary }]}>Значения даны</Text>
      <View style={styles.chips}>
        {units.map((item) => <SelectionChip key={item.id} group="Единица" label={item.label} selected={unit === item.id}
          onPress={() => { setUnit(item.id); setAmount(item.amount); }} />)}
      </View>
      <TextField label={`Количество, ${unit === "G" ? "г" : unit === "ML" ? "мл" : "порц."}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" required />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Заполните то, что известно. Пустое значение остаётся «нет данных», а не нулём.</Text>
      <TextField label={kcalAuto ? "Калории, ккал (авто из Б/Ж/У)" : "Калории, ккал"} value={kcalText} onChangeText={(kcal) => { setValues({ ...values, kcal }); setKcalManual(kcal.trim() !== ""); }} keyboardType="decimal-pad"
        hint="1 г белка = 4 ккал, жира = 9, углеводов = 4. Можно ввести своё число — оно заменит авторасчёт." />
      <View style={styles.macroRow}>
        <View style={styles.cell}><TextField label="Белки, г" value={values.protein} onChangeText={(protein) => setValues({ ...values, protein })} keyboardType="decimal-pad" /></View>
        <View style={styles.cell}><TextField label="Жиры, г" value={values.fat} onChangeText={(fat) => setValues({ ...values, fat })} keyboardType="decimal-pad" /></View>
        <View style={styles.cell}><TextField label="Углеводы, г" value={values.carbs} onChangeText={(carbs) => setValues({ ...values, carbs })} keyboardType="decimal-pad" /></View>
      </View>
      <AppButton label={foodId === undefined ? "Сохранить продукт" : "Сохранить изменения продукта"} onPress={() => { void save(); }} busy={busy} />
      {foodId !== undefined ? <AppButton variant="destructive" label="Убрать продукт из каталога" disabled={busy} onPress={() => setConfirmArchive(true)} /> : null}
      <ConfirmDialog visible={confirmArchive} title="Убрать продукт из каталога?" description="Продукт перестанет предлагаться. Дневники и состав существующих рецептов сохранятся." confirmLabel="Убрать" destructive confirmBusy={busy}
        onCancel={() => setConfirmArchive(false)} onConfirm={() => {
          if (foodId === undefined || lock.current) return;
          lock.current = true; setBusy(true);
          void foods.archive(foodId, revision).then((food) => { onDirtyChange?.(false); onSaved(food); }, (failure: unknown) => setError(nutritionErrorText(failure)))
            .finally(() => { lock.current = false; setBusy(false); setConfirmArchive(false); });
        }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  macroRow: { flexDirection: "row", gap: 8 },
  cell: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
