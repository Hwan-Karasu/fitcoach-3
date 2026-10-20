import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, SearchField, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import type { FoodProduct, Nutrients } from "../domain/FoodModel.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import type { RecipeCatalogPort } from "../domain/RecipeCatalogPort.ts";
import { recipeBases } from "../domain/RecipeRules.ts";
import { metricLabels, nutritionErrorText, unitLabels, wholeText } from "./nutritionFormat.ts";

interface Row { readonly food: FoodProduct; readonly quantity: string }

function BasisLine({ title, nutrients }: Readonly<{ title: string; nutrients: Nutrients }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessible accessibilityLabel={`${title}: ${metricLabels.kcal} ${wholeText(nutrients.kcalX10)}, ${metricLabels.protein} ${wholeText(nutrients.proteinX10)}, ${metricLabels.fat} ${wholeText(nutrients.fatX10)}, ${metricLabels.carbs} ${wholeText(nutrients.carbsX10)}`}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {`${wholeText(nutrients.kcalX10)} ккал · Б ${wholeText(nutrients.proteinX10)} · Ж ${wholeText(nutrients.fatX10)} · У ${wholeText(nutrients.carbsX10)}`}</Text>
    </View>
  );
}

/**
 * Рецепт из собственных продуктов (§49.4): название, число порций, масса готового блюда (необязательно), состав с количествами. Пищевая ценность — только сумма
 * ингредиентов; неизвестное значение у любого ингредиента оставляет итог неизвестным («—»). Правка меняет будущие использования, прошлые дни не пересчитываются.
 */
export function RecipeEditorScreen({ recipeId, foods, recipes, onSaved }: Readonly<{ recipeId?: string; foods: FoodCatalogPort; recipes: RecipeCatalogPort; onSaved: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [loaded, setLoaded] = useState(recipeId === undefined);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [servings, setServings] = useState("1");
  const [mass, setMass] = useState("");
  const [description, setDescription] = useState("");
  const [flags, setFlags] = useState<Readonly<{ favorite: boolean; inCookbook: boolean }>>({ favorite: false, inCookbook: false });
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<readonly FoodProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);

  useEffect(() => {
    if (recipeId === undefined) return undefined;
    let active = true;
    void recipes.get(recipeId).then((recipe) => {
      if (!active) return;
      if (recipe === null) { setError("Рецепт не найден."); setLoaded(true); return; }
      setName(recipe.name); setServings(formatDecimalX10(recipe.servingsX10)); setMass(recipe.cookedMassX10 === null ? "" : formatDecimalX10(recipe.cookedMassX10));
      setRows(recipe.ingredients.map((item) => ({ food: item.food, quantity: formatDecimalX10(item.quantityX10) }))); setRevision(recipe.revision); setDescription(recipe.description ?? "");
      setFlags({ favorite: recipe.favorite === true, inCookbook: recipe.inCookbook === true }); setLoaded(true);
    }, () => { if (active) { setError("Не удалось загрузить рецепт."); setLoaded(true); } });
    return () => { active = false; };
  }, [recipeId, recipes]);
  useEffect(() => {
    if (!picking) return undefined;
    let active = true;
    void foods.search(query).then((found) => { if (active) setOptions(found); }, () => { if (active) setOptions([]); });
    return () => { active = false; };
  }, [foods, picking, query]);

  const servingsX10 = parseDecimalX10(servings);
  const massX10 = mass.trim() === "" ? null : parseDecimalX10(mass);
  const preview = useMemo(() => {
    const ingredients = rows.map((row) => ({ food: row.food, quantityX10: parseDecimalX10(row.quantity) ?? 0 }));
    if (servingsX10 === null || servingsX10 <= 0 || ingredients.length === 0 || ingredients.some((item) => item.quantityX10 <= 0) || massX10 === 0) return null;
    return recipeBases({ ingredients, servingsX10, cookedMassX10: massX10 });
  }, [rows, servingsX10, massX10]);

  const save = async () => {
    if (servingsX10 === null || servingsX10 <= 0) { setError("Укажите число порций, например 4."); return; }
    if (massX10 === null && mass.trim() !== "") { setError("Масса готового блюда — число, например 850."); return; }
    const ingredients = rows.map((row) => ({ foodId: row.food.id, quantityX10: parseDecimalX10(row.quantity) ?? 0 }));
    if (ingredients.some((item) => item.quantityX10 <= 0)) { setError("Укажите количество каждого ингредиента."); return; }
    setBusy(true);
    try {
      const input = { name, servingsX10, cookedMassX10: massX10, description: description.trim() === "" ? null : description, ingredients };
      if (recipeId === undefined) await recipes.create(input); else await recipes.update(recipeId, revision, input);
      onSaved();
    } catch (failure) {
      setError(recipeError(failure));
      setBusy(false);
    }
  };
  const toggle = async (kind: "favorite" | "inCookbook") => {
    if (recipeId === undefined) return;
    try {
      const next = kind === "favorite" ? await recipes.setFavorite(recipeId, !flags.favorite) : await recipes.setInCookbook(recipeId, !flags.inCookbook);
      setFlags({ favorite: next.favorite === true, inCookbook: next.inCookbook === true });
      setError(null);
    } catch (failure) { setError(recipeError(failure)); }
  };
  const hide = async () => {
    if (recipeId === undefined) return;
    setBusy(true);
    try { await recipes.archive(recipeId, revision); onSaved(); } catch (failure) { setError(recipeError(failure)); setBusy(false); setConfirmHide(false); }
  };

  if (!loaded) return <LoadingState label="Загружаем рецепт…" />;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <TextField label="Название" value={name} onChangeText={setName} required autoCapitalize="sentences" />
      <TextField label="Число порций" value={servings} onChangeText={setServings} keyboardType="decimal-pad" required />
      <TextField label="Описание" value={description} onChangeText={setDescription} multiline hint="Необязательно, до 500 знаков." />
      <TextField label="Масса готового блюда, г" value={mass} onChangeText={setMass} keyboardType="decimal-pad"
        hint="Необязательно. Без неё рецепт вносится только в порциях — масса не выдумывается по сырому весу." />

      <Text style={[styles.heading, { color: colors.textPrimary }]}>Состав</Text>
      {rows.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Добавьте продукты из своего каталога.</Text> : null}
      {rows.map((row, index) => (
        <View key={row.food.id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.rowHead}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{row.food.name}</Text>
            <AppIconButton label={`Убрать ингредиент ${row.food.name}`} icon={<Trash2 size={20} color={colors.danger} />}
              onPress={() => setRows(rows.filter((_, position) => position !== index))} />
          </View>
          <TextField label={`Количество, ${unitLabels[row.food.unit]}`} value={row.quantity} keyboardType="decimal-pad"
            onChangeText={(quantity) => setRows(rows.map((item, position) => position === index ? { ...item, quantity } : item))} />
        </View>
      ))}
      {picking ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск продукта для рецепта" placeholder="Поиск продукта" />
          {options.filter((food) => !rows.some((row) => row.food.id === food.id)).map((food) => (
            <Pressable key={food.id} accessibilityRole="button" accessibilityLabel={`Добавить ингредиент ${food.name}`} style={styles.option}
              onPress={() => { setRows([...rows, { food, quantity: formatDecimalX10(food.amountX10) }]); setPicking(false); setQuery(""); }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{food.name}</Text>
            </Pressable>
          ))}
          {options.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Продуктов не найдено. Создайте продукт в разделе «Добавить еду».</Text> : null}
          <AppButton variant="ghost" label="Закрыть" onPress={() => setPicking(false)} />
        </View>
      ) : <AppButton variant="secondary" label="Добавить ингредиент" onPress={() => setPicking(true)} />}

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Пищевая ценность</Text>
        {preview === null ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Появится, когда заполнены порции и количества.</Text>
          : preview.map((item) => <BasisLine key={item.basis.unit} title={item.basis.unit === "PORTION" ? "На порцию" : "На 100 г готового блюда"} nutrients={item.nutrients} />)}
        <Text style={[styles.meta, { color: colors.textMuted }]}>Сумма ингредиентов. «—» — у какого-то ингредиента нет этого значения.</Text>
      </View>

      {recipeId !== undefined ? <View style={styles.rowHead}>
        <View style={styles.flex}><AppButton compact variant="secondary" label={flags.inCookbook ? "Убрать из кулинарной книги" : "Добавить в кулинарную книгу"} disabled={busy} onPress={() => { void toggle("inCookbook"); }} /></View>
        <View style={styles.flex}><AppButton compact variant="ghost" label={flags.favorite ? "Убрать из избранного" : "В избранное"} disabled={busy} onPress={() => { void toggle("favorite"); }} /></View>
      </View> : null}
      <AppButton label={recipeId === undefined ? "Сохранить рецепт" : "Сохранить изменения"} onPress={() => { void save(); }} busy={busy} />
      {recipeId !== undefined ? <AppButton variant="destructive" label="Убрать рецепт из каталога" disabled={busy} onPress={() => setConfirmHide(true)} /> : null}
      <ConfirmDialog visible={confirmHide} destructive title="Убрать рецепт из каталога?" confirmLabel="Убрать" onCancel={() => setConfirmHide(false)} onConfirm={() => { void hide(); }}
        description="Рецепт перестанет предлагаться при добавлении еды. Уже внесённые записи в дневниках не изменятся." />
    </ScrollView>
  );
}

function recipeError(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "RECIPE_NAME_INVALID": return "Введите название (до 80 символов).";
    case "RECIPE_SERVINGS_INVALID": return "Число порций — больше нуля.";
    case "RECIPE_DESCRIPTION_INVALID": return "Описание — не длиннее 500 знаков.";
    case "RECIPE_MASS_INVALID": return "Масса готового блюда — больше нуля.";
    case "RECIPE_INGREDIENT_INVALID": return "Добавьте хотя бы один ингредиент с количеством больше нуля.";
    case "FOOD_SOURCE_UNAVAILABLE": return "Один из продуктов недоступен (скрыт). Уберите его из состава.";
    case "RECIPE_STALE": return "Рецепт уже изменился. Откройте его заново.";
    default: return nutritionErrorText(error);
  }
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  flex: { flex: 1 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  option: { minHeight: 48, justifyContent: "center" },
});
