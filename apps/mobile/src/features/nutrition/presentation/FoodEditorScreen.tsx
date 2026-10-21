import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { AppButton, AppIconButton, ChoiceSegments, ConfirmDialog, InlineNotice, LoadingState, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { STANDARD_EXTRA_NUTRIENTS, type ExtraNutrient, type ExtraNutrientUnit, type FoodBasisUnit, type FoodProduct } from "../domain/FoodModel.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import { kcalFromMacrosX10, kcalIsDerived } from "../domain/EnergyRules.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import { nutritionErrorText } from "./nutritionFormat.ts";

const units: readonly Readonly<{ id: FoodBasisUnit; label: string; amount: string }>[] = [
  { id: "G", label: "г", amount: "100" }, { id: "ML", label: "мл", amount: "100" }, { id: "PIECE", label: "шт.", amount: "1" }, { id: "PORTION", label: "порция", amount: "1" },
];
const extraUnits: readonly Readonly<{ id: ExtraNutrientUnit; label: string }>[] = [{ id: "G", label: "г" }, { id: "MG", label: "мг" }];
const extraUnitText: Readonly<Record<ExtraNutrientUnit, string>> = { G: "г", MG: "мг" };
const GROUPS = [{ id: "fat", title: "Жир" }, { id: "carbs", title: "Углеводы" }, { id: "other", title: "Другое" }] as const;

interface CustomRow { readonly id: number; readonly label: string; readonly unit: ExtraNutrientUnit; readonly value: string }
const customKey = (id: number) => `custom:${id}`;

/** Пустое поле — «не введено» (`null`), а не ноль; непустое некорректное — ошибка поля. */
function optionalValue(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  return parseDecimalX10(text) ?? "invalid";
}

/**
 * Собственный продукт (§49.3): название, на какое количество даны значения (г, мл, шт., порц.), БЖУ 2×2 и дополнительные нутриенты. Значения, которые
 * тренер не знает, остаются пустыми и не превращаются в ноль. «Добавить» при правке сохраняет тот же продукт, а не создаёт копию. Каталог общий для всех клиентов.
 */
export function FoodEditorScreen({ foods, foodId, initialName = "", detailsRequest = 0, onSaved, onDirtyChange }: Readonly<{ foods: FoodCatalogPort; foodId?: string; initialName?: string;
  /** Растёт при нажатии на карандаш в шапке: открывает окно с названием, маркой, штрихкодом и «Удалить из базы». */
  detailsRequest?: number; onSaved: (food: FoodProduct) => void; onDirtyChange?: (dirty: boolean) => void }>) {
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
  const [extra, setExtra] = useState<Readonly<Record<string, string>>>({});
  const [custom, setCustom] = useState<readonly CustomRow[]>([]);
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ name: "", brand: "", barcode: "", pieceMass: "" });
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const handledRequest = useRef(detailsRequest);
  const [initialSignature, setInitialSignature] = useState<string | null>(null);
  const signature = JSON.stringify({ name, brand, barcode, pieceMass, unit, amount, values, kcalManual, extra, custom });
  useEffect(() => {
    if (loaded && initialSignature === null) setInitialSignature(signature);
    if (initialSignature !== null) onDirtyChange?.(signature !== initialSignature);
  }, [loaded, initialSignature, signature, onDirtyChange]);
  useEffect(() => {
    if (!loaded || detailsRequest === handledRequest.current) return;
    handledRequest.current = detailsRequest;
    setDetailsDraft({ name, brand, barcode, pieceMass });
    setDetailsError(null);
    setDetailsOpen(true);
  }, [detailsRequest, loaded, name, brand, barcode, pieceMass]);
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
      setKcalManual(food.kcalX10 !== null && !kcalIsDerived(food)); setRevision(food.revision);
      const standard = new Set(STANDARD_EXTRA_NUTRIENTS.map((item) => item.key));
      const saved = food.extraNutrients ?? [];
      setExtra(Object.fromEntries(saved.filter((item) => standard.has(item.key)).map((item) => [item.key, formatDecimalX10(item.valueX10)])));
      setCustom(saved.filter((item) => !standard.has(item.key)).map((item, index) => ({ id: index + 1, label: item.label, unit: item.unit, value: formatDecimalX10(item.valueX10) })));
      setLoaded(true);
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
    const extraNutrients: ExtraNutrient[] = [];
    for (const item of STANDARD_EXTRA_NUTRIENTS) {
      const text = extra[item.key] ?? "";
      if (text.trim() === "") continue;
      const valueX10 = parseDecimalX10(text);
      if (valueX10 === null) { setError(`${item.label}: число не более чем с одним знаком после запятой, например 1,5.`); return; }
      extraNutrients.push({ key: item.key, label: item.label, unit: item.unit, valueX10 });
    }
    for (const row of custom) {
      if (row.label.trim() === "" && row.value.trim() === "") continue;
      const valueX10 = parseDecimalX10(row.value);
      if (row.label.trim() === "" || valueX10 === null) { setError("Своя строка: укажите название и число, например 1,5."); return; }
      extraNutrients.push({ key: customKey(row.id), label: row.label, unit: row.unit, valueX10 });
    }
    lock.current = true; setBusy(true);
    try {
      const input = { name, brand: brand.trim() === "" ? null : brand, unit, amountX10, barcode: barcode.trim() === "" ? null : barcode, gramsPerPieceX10: pieceX10, kcalX10: parsed.kcalX10 as number | null,
        proteinX10: parsed.proteinX10 as number | null, fatX10: parsed.fatX10 as number | null, carbsX10: parsed.carbsX10 as number | null, extraNutrients };
      const created = foodId === undefined ? await foods.create(input) : await foods.update(foodId, revision, input);
      onDirtyChange?.(false);
      onSaved(created);
    } catch (failure) {
      setError(nutritionErrorText(failure));
      setBusy(false);
    } finally { lock.current = false; }
  };

  if (!loaded) return <LoadingState label="Загружаем продукт…" />;
  const applyDetails = () => {
    if (detailsDraft.name.trim() === "") { setDetailsError("Укажите название продукта."); return; }
    if (detailsDraft.pieceMass.trim() !== "" && parseDecimalX10(detailsDraft.pieceMass) === null) { setDetailsError("Масса одной штуки — число, например 45."); return; }
    setName(detailsDraft.name); setBrand(detailsDraft.brand); setBarcode(detailsDraft.barcode); setPieceMass(detailsDraft.pieceMass);
    setDetailsOpen(false);
  };
  const updateCustom = (id: number, patch: Partial<CustomRow>) => setCustom(custom.map((item) => item.id === id ? { ...item, ...patch } : item));
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {foodId === undefined ? <>
      <TextField label="Название" value={name} onChangeText={setName} required autoCapitalize="sentences" />
      <AppButton compact variant="ghost" label={details ? "Скрыть дополнительные поля" : "Марка, штрихкод и масса штуки"} onPress={() => setDetails(!details)} />
      </> : null}
      {foodId === undefined && details ? <>
      <TextField label="Марка или описание" value={brand} onChangeText={setBrand} hint="Необязательно" />
      <TextField label="Штрихкод" value={barcode} onChangeText={setBarcode} hint="Необязательно. Только для локального поиска: сетевого справочника нет." />
      <TextField label="Масса одной штуки, г" value={pieceMass} onChangeText={setPieceMass} keyboardType="decimal-pad"
        hint="Необязательно. Если указать, при добавлении еды можно вводить штуки; без неё штуки недоступны." />
      </> : null}
      <Text style={[styles.label, { color: colors.textPrimary }]}>Значения даны на</Text>
      <View style={styles.unitRow}>
        <View style={styles.amountCell}><TextField label="Количество" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" required /></View>
        <View style={styles.unitCell}><ChoiceSegments label="Единица" items={units} value={unit} onChange={(next) => { setUnit(next); setAmount(units.find((item) => item.id === next)?.amount ?? "1"); }} /></View>
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Заполните то, что известно. Пустое значение остаётся «нет данных», а не нулём.</Text>
      <View style={styles.macroRow}>
        <View style={styles.cell}><TextField label="Белки, г" value={values.protein} onChangeText={(protein) => setValues({ ...values, protein })} keyboardType="decimal-pad" /></View>
        <View style={styles.cell}><TextField label="Жиры, г" value={values.fat} onChangeText={(fat) => setValues({ ...values, fat })} keyboardType="decimal-pad" /></View>
      </View>
      <View style={styles.macroRow}>
        <View style={styles.cell}><TextField label="Углеводы, г" value={values.carbs} onChangeText={(carbs) => setValues({ ...values, carbs })} keyboardType="decimal-pad" /></View>
        <View style={styles.cell}><TextField label={kcalAuto ? "Калории (авто)" : "Калории, ккал"} value={kcalText} onChangeText={(kcal) => { setValues({ ...values, kcal }); setKcalManual(kcal.trim() !== ""); }} keyboardType="decimal-pad" /></View>
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>1 г белка = 4 ккал, жира = 9, углеводов = 4. Своё число калорий заменит авторасчёт.</Text>
      {GROUPS.map((group) => <View key={group.id} style={styles.group}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{group.id === "fat" ? "Жир, г" : group.title}</Text>
        {group.id === "fat" ? <View style={styles.macroRow}>
          {STANDARD_EXTRA_NUTRIENTS.filter((item) => item.group === "fat").map((item) => <View key={item.key} style={styles.cell}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.fatLabel, { color: colors.textSecondary }]}>{item.label.replace(" жиры", "")}</Text>
            <TextField label={`${item.label}, г`} hideLabel value={extra[item.key] ?? ""} onChangeText={(text) => setExtra({ ...extra, [item.key]: text })} keyboardType="decimal-pad" />
          </View>)}
        </View> : <View style={styles.extraGrid}>
          {STANDARD_EXTRA_NUTRIENTS.filter((item) => item.group === group.id).map((item) => <View key={item.key} style={styles.extraCell}>
            <TextField label={`${item.label}, ${extraUnitText[item.unit]}`} value={extra[item.key] ?? ""} onChangeText={(text) => setExtra({ ...extra, [item.key]: text })} keyboardType="decimal-pad" />
          </View>)}
        </View>}
      </View>)}
      {custom.map((row) => <View key={row.id} style={styles.customRow}>
        <View style={styles.cell}><TextField label="Название" value={row.label} onChangeText={(label) => updateCustom(row.id, { label })} autoCapitalize="sentences" /></View>
        <View style={styles.customValue}><TextField label="Значение" value={row.value} onChangeText={(value) => updateCustom(row.id, { value })} keyboardType="decimal-pad" /></View>
        <View style={styles.customUnit}><ChoiceSegments label="Единица" items={extraUnits} value={row.unit} onChange={(next) => updateCustom(row.id, { unit: next })} /></View>
        <AppIconButton compact label={`Убрать строку: ${row.label || "без названия"}`} icon={<X size={18} color={colors.textSecondary} />} onPress={() => setCustom(custom.filter((item) => item.id !== row.id))} />
      </View>)}
      <AppButton compact variant="secondary" label="+ Добавить" accessibilityLabel="Добавить свой нутриент" onPress={() => setCustom([...custom, { id: Math.max(0, ...custom.map((item) => item.id)) + 1, label: "", unit: "G", value: "" }])} />
    </ScrollView>
    <View style={[styles.bottomBar, { backgroundColor: colors.canvas, borderColor: colors.border }]}>
      <AppButton label={foodId === undefined ? "Добавить" : "Сохранить"} accessibilityLabel={foodId === undefined ? "Добавить продукт" : "Сохранить изменения продукта"} onPress={() => { void save(); }} busy={busy} />
    </View>
    <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
      <View style={styles.backdrop}><View style={[styles.dialog, { backgroundColor: colors.surface }]}>
        <Text accessibilityRole="header" style={[styles.dialogTitle, { color: colors.textPrimary }]}>Карточка продукта</Text>
        {detailsError !== null ? <InlineNotice kind="error">{detailsError}</InlineNotice> : null}
        <TextField label="Название" value={detailsDraft.name} onChangeText={(next) => setDetailsDraft({ ...detailsDraft, name: next })} required autoCapitalize="sentences" />
        <TextField label="Марка или описание" value={detailsDraft.brand} onChangeText={(next) => setDetailsDraft({ ...detailsDraft, brand: next })} />
        <TextField label="Штрихкод" value={detailsDraft.barcode} onChangeText={(next) => setDetailsDraft({ ...detailsDraft, barcode: next })} />
        <TextField label="Масса одной штуки, г" value={detailsDraft.pieceMass} onChangeText={(next) => setDetailsDraft({ ...detailsDraft, pieceMass: next })} keyboardType="decimal-pad" />
        <AppButton label="Готово" onPress={applyDetails} />
        <AppButton variant="ghost" label="Отмена" onPress={() => setDetailsOpen(false)} />
        {foodId !== undefined ? <AppButton variant="destructive" label="Удалить из базы" disabled={busy} onPress={() => { setDetailsOpen(false); setConfirmArchive(true); }} /> : null}
      </View></View>
    </Modal>
    <ConfirmDialog visible={confirmArchive} title="Убрать продукт из каталога?" description="Продукт перестанет предлагаться. Дневники и состав существующих рецептов сохранятся." confirmLabel="Убрать" destructive confirmBusy={busy}
        onCancel={() => setConfirmArchive(false)} onConfirm={() => {
          if (foodId === undefined || lock.current) return;
          lock.current = true; setBusy(true);
          void foods.archive(foodId, revision).then((food) => { onDirtyChange?.(false); onSaved(food); }, (failure: unknown) => setError(nutritionErrorText(failure)))
            .finally(() => { lock.current = false; setBusy(false); setConfirmArchive(false); });
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  bottomBar: { paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  fatLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 14 },
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  macroRow: { flexDirection: "row", gap: 8 },
  cell: { flex: 1, minWidth: 0 },
  unitRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  amountCell: { width: 110 },
  unitCell: { flex: 1, minWidth: 0, paddingTop: 22 },
  group: { gap: 6 },
  extraGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  extraCell: { width: "48%", flexGrow: 1 },
  customRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  customValue: { width: 84 },
  customUnit: { width: 84, paddingTop: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
