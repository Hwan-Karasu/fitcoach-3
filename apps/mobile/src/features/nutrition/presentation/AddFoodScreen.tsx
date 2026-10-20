import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, EmptyState, InlineNotice, SearchField, SegmentedControl, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { MealSlot } from "../domain/DiaryModel.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import type { FoodProduct } from "../domain/FoodModel.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import { snapshotOfFood, snapshotOfRecipe, type FoodSnapshot } from "../domain/FoodSnapshot.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { RecipeCatalogPort } from "../domain/RecipeCatalogPort.ts";
import type { Recipe } from "../domain/RecipeModel.ts";
import { recipeBases } from "../domain/RecipeRules.ts";
import { basisText, kcalText, nutritionErrorText, slotLabels, unitLabels } from "./nutritionFormat.ts";

type Item = Readonly<{ kind: "FOOD"; food: FoodProduct }> | Readonly<{ kind: "RECIPE"; recipe: Recipe }>;
const itemKey = (item: Item) => item.kind === "FOOD" ? `f:${item.food.id}` : `r:${item.recipe.id}`;

/** Снимок для выбранной позиции и количества; `null` — количество не разобрано. */
function snapshotFor(item: Item, recipeUnit: "PORTION" | "G", quantityX10: number): FoodSnapshot {
  return item.kind === "FOOD" ? snapshotOfFood(item.food, quantityX10) : snapshotOfRecipe(item.recipe, recipeUnit, quantityX10);
}

function ItemCard({ item, open, onToggle, onAdd }: Readonly<{ item: Item; open: boolean; onToggle: () => void;
  onAdd: (snapshot: FoodSnapshot) => Promise<string | null> }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const bases = item.kind === "RECIPE" ? recipeBases(item.recipe) : [];
  const [recipeUnit, setRecipeUnit] = useState<"PORTION" | "G">("PORTION");
  const basis = item.kind === "FOOD" ? { unit: item.food.unit, amountX10: item.food.amountX10 }
    : (bases.find((candidate) => candidate.basis.unit === recipeUnit) ?? bases[0]!).basis;
  const [text, setText] = useState(() => formatDecimalX10(basis.amountX10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quantity = parseDecimalX10(text);
  const preview = useMemo(() => {
    if (quantity === null || quantity <= 0) return null;
    try { return snapshotFor(item, recipeUnit, quantity).eaten; } catch { return null; }
  }, [item, recipeUnit, quantity]);
  const name = item.kind === "FOOD" ? item.food.name : item.recipe.name;
  const sub = item.kind === "FOOD" ? [item.food.brand, `${basisText(basis)}: ${kcalText({ kcalX10: item.food.kcalX10, proteinX10: null, fatX10: null, carbsX10: null })}`]
    .filter((part) => part !== null).join(" · ") : `Рецепт · ${item.recipe.ingredients.length} ингр.`;

  const add = async () => {
    if (quantity === null || quantity <= 0) { setError("Введите количество, например 150 или 1,5."); return; }
    setBusy(true);
    const message = await onAdd(snapshotFor(item, recipeUnit, quantity));
    setBusy(false);
    setError(message);
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${name}. ${sub}. ${open ? "Свернуть" : "Указать количество"}`}
        onPress={onToggle} style={styles.cardHead}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{sub}</Text>
      </Pressable>
      {open ? <View style={styles.portion}>
        {item.kind === "RECIPE" && bases.length > 1 ? <SegmentedControl items={[{ id: "PORTION", label: "Порции" }, { id: "G", label: "Граммы" }]} selectedId={recipeUnit}
          onSelect={(next) => { setRecipeUnit(next); setText(next === "G" ? "100" : "1"); }} /> : null}
        <View style={styles.qtyRow}>
          <View style={styles.grow}><TextField label={`Количество, ${unitLabels[basis.unit]}`} value={text} onChangeText={(next) => { setText(next); setError(null); }} keyboardType="decimal-pad" /></View>
          <View style={styles.grow}><AppButton label="Добавить" onPress={() => { void add(); }} busy={busy} /></View>
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{preview === null ? " " : `Будет внесено: ${kcalText(preview)}`}</Text>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </View> : null}
    </View>
  );
}

/**
 * Добавление еды в приём пищи (§49.2): локальный поиск по своим продуктам и рецептам, выбор, количество, «Добавить». Можно добавить несколько позиций подряд;
 * экран остаётся открытым, пока тренер не вернётся к дневнику. Нет нужного продукта — «Создать продукт».
 */
export function AddFoodScreen({ clientId, localDate, slot, foods, recipes, diary, onCreateFood }: Readonly<{
  clientId: string;
  localDate: string;
  slot: MealSlot;
  foods: FoodCatalogPort;
  recipes: RecipeCatalogPort;
  diary: NutritionDiaryPort;
  onCreateFood: (name: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([foods.search(query), recipes.search(query)]).then(([foodRows, recipeRows]) => {
      if (active) {
        setItems([...recipeRows.map((recipe) => ({ kind: "RECIPE", recipe }) as const), ...foodRows.map((food) => ({ kind: "FOOD", food }) as const)]);
        setFailed(false);
      }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [foods, recipes, query, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offFoods = foods.subscribeCommittedChanges(refresh);
    const offRecipes = recipes.subscribeCommittedChanges(refresh);
    return () => { offFoods(); offRecipes(); };
  }, [foods, recipes]);

  const add = useCallback(async (snapshot: FoodSnapshot): Promise<string | null> => {
    try {
      await diary.addEntry(clientId, { localDate, slot, snapshot });
      setAdded(snapshot.name);
      return null;
    } catch (failure) {
      return nutritionErrorText(failure);
    }
  }, [clientId, diary, localDate, slot]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{`В приём пищи: ${slotLabels[slot]}`}</Text>
        <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск продукта или рецепта" placeholder="Поиск продукта или рецепта" />
        {added !== null ? <InlineNotice kind="success">{`Добавлено: ${added}`}</InlineNotice> : null}
        {failed ? <InlineNotice kind="error">Не удалось загрузить каталог.</InlineNotice> : null}
      </View>
      <FlatList data={items ?? []} keyExtractor={itemKey} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<AppButton compact variant="secondary" label="Создать продукт" onPress={() => onCreateFood(query.trim())} />}
        ListEmptyComponent={items === null ? null : <EmptyState reason={query.trim() === "" ? "no-data" : "no-match"}
          title={query.trim() === "" ? "Каталог пока пуст" : "Ничего не найдено"}
          body={query.trim() === "" ? "Здесь появятся ваши продукты и рецепты. Создайте первый продукт." : "Измените запрос или создайте такой продукт."}
          action={{ label: "Создать продукт", onPress: () => onCreateFood(query.trim()) }} />}
        renderItem={({ item }) => <ItemCard item={item} open={openKey === itemKey(item)} onToggle={() => setOpenKey(openKey === itemKey(item) ? null : itemKey(item))} onAdd={add} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  cardHead: { gap: 2, minHeight: 48, justifyContent: "center" },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  portion: { gap: 8 },
  qtyRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
});
