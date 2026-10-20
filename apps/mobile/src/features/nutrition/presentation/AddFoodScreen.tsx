import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, Star } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, EmptyState, InlineNotice, SearchField, SegmentedControl, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type MealSlot } from "../domain/DiaryModel.ts";
import { rankUsage } from "../domain/DiaryRules.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import type { FoodProduct } from "../domain/FoodModel.ts";
import { formatDecimalX10, gramsFromPieces, parseDecimalX10 } from "../domain/FoodRules.ts";
import { snapshotOfFood, snapshotOfRecipe, type FoodSnapshot } from "../domain/FoodSnapshot.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { RecipeCatalogPort } from "../domain/RecipeCatalogPort.ts";
import type { Recipe } from "../domain/RecipeModel.ts";
import { recipeBases } from "../domain/RecipeRules.ts";
import { planBatch, type SelectedPick } from "../domain/SelectionRules.ts";
import { basisText, kcalText, nutritionErrorText, shiftDate, slotLabels, todayLocal, unitLabels } from "./nutritionFormat.ts";

type Item = Readonly<{ kind: "FOOD"; food: FoodProduct }> | Readonly<{ kind: "RECIPE"; recipe: Recipe }>;
/** Категории каталога (P-25). «Недавние» и «Частые» — производное чтение дневника клиента, без отдельного хранилища. */
export type CatalogFilter = "ALL" | "RECENT" | "FREQUENT" | "FAVORITES" | "FOODS" | "RECIPES" | "COOKBOOK";
const filters: readonly Readonly<{ id: CatalogFilter; label: string }>[] = [{ id: "ALL", label: "Все" }, { id: "RECENT", label: "Недавние" }, { id: "FREQUENT", label: "Частые" },
  { id: "FAVORITES", label: "Избранное" }, { id: "FOODS", label: "Продукты" }, { id: "RECIPES", label: "Рецепты" }, { id: "COOKBOOK", label: "Кулинарная книга" }];
const USAGE_DAYS = 120;
const USAGE_LIMIT = 50;
const emptyBodies: Readonly<Record<CatalogFilter, string>> = {
  ALL: "Здесь появятся ваши продукты и рецепты. Создайте первый продукт.", RECENT: "Недавно добавленных позиций у этого клиента пока нет.",
  FREQUENT: "Частые позиции появятся после нескольких записей в дневнике.", FAVORITES: "Отметьте продукт или рецепт звёздочкой — он появится здесь.",
  FOODS: "Продуктов пока нет. Создайте первый.", RECIPES: "Рецептов пока нет. Создайте первый.", COOKBOOK: "Добавьте рецепт в кулинарную книгу — он появится здесь." };
const isFavorite = (item: Item) => (item.kind === "FOOD" ? item.food.favorite : item.recipe.favorite) === true;
const itemKey = (item: Item) => item.kind === "FOOD" ? `f:${item.food.id}` : `r:${item.recipe.id}`;
const itemName = (item: Item) => item.kind === "FOOD" ? item.food.name : item.recipe.name;

/** Снимок для позиции и количества. */
function snapshotFor(item: Item, recipeUnit: "PORTION" | "G", quantityX10: number): FoodSnapshot {
  return item.kind === "FOOD" ? snapshotOfFood(item.food, quantityX10) : snapshotOfRecipe(item.recipe, recipeUnit, quantityX10);
}

/** Порция по умолчанию при отметке без редактора: эталонная основа продукта или одна порция рецепта. */
function defaultSnapshot(item: Item): FoodSnapshot {
  return item.kind === "FOOD" ? snapshotOfFood(item.food, item.food.amountX10) : snapshotOfRecipe(item.recipe, "PORTION", 10);
}

/** Черновик редактора порции одной карточки: переживает свёртывание, поиск и смену категории, пока выбор не отправлен или не очищен (NUT-FS-23, 26). */
interface PortionDraft { readonly mode: "BASIS" | "PIECES"; readonly recipeUnit: "PORTION" | "G"; readonly text: string }

function Checkbox({ checked, label, onPress }: Readonly<{ checked: boolean; label: string; onPress: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onPress} style={styles.checkHit}>
      <View style={[styles.checkBox, { borderColor: checked ? colors.accentFill : colors.border, backgroundColor: checked ? colors.accentFill : "transparent" }]}>
        {checked ? <Check size={16} color={colors.onAccentFill} /> : null}
      </View>
    </Pressable>
  );
}

function ItemCard({ item, selected, selectedLabel, draft, open, onToggleOpen, onToggleSelect, onSavePortion, onEditRecipe, onFavorite, onCookbook }: Readonly<{ item: Item; selected: boolean; selectedLabel: string | null;
  draft: PortionDraft | undefined; open: boolean; onToggleOpen: () => void; onToggleSelect: () => void; onSavePortion: (draft: PortionDraft, snapshot: FoodSnapshot) => void;
  onEditRecipe: (recipeId: string) => void; onFavorite: (item: Item) => void; onCookbook: (recipe: Recipe) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const bases = item.kind === "RECIPE" ? recipeBases(item.recipe) : [];
  const [recipeUnit, setRecipeUnit] = useState<"PORTION" | "G">(draft?.recipeUnit ?? "PORTION");
  const basis = item.kind === "FOOD" ? { unit: item.food.unit, amountX10: item.food.amountX10 }
    : (bases.find((candidate) => candidate.basis.unit === recipeUnit) ?? bases[0]!).basis;
  const pieceMass = item.kind === "FOOD" && item.food.unit === "G" ? (item.food.gramsPerPieceX10 ?? null) : null;
  const [mode, setMode] = useState<"BASIS" | "PIECES">(draft?.mode ?? "BASIS");
  const [text, setText] = useState(() => draft?.text ?? formatDecimalX10(basis.amountX10));
  const [error, setError] = useState<string | null>(null);
  const typed = parseDecimalX10(text);
  /** Штуки переводятся в граммы по массе штуки продукта; в дневник уходит количество в основе продукта. */
  const quantity = useMemo(() => {
    if (typed === null || typed <= 0) return null;
    if (mode === "BASIS") return typed;
    try { return gramsFromPieces(typed, pieceMass); } catch { return null; }
  }, [typed, mode, pieceMass]);
  const preview = useMemo(() => {
    if (quantity === null || quantity <= 0) return null;
    try { return snapshotFor(item, recipeUnit, quantity).eaten; } catch { return null; }
  }, [item, recipeUnit, quantity]);
  const name = itemName(item);
  const sub = item.kind === "FOOD" ? [item.food.brand, `${basisText(basis)}: ${kcalText({ kcalX10: item.food.kcalX10, proteinX10: null, fatX10: null, carbsX10: null })}`]
    .filter((part) => part !== null).join(" · ") : `Рецепт · ${item.recipe.ingredients.length} ингр.`;

  const save = () => {
    if (quantity === null || quantity <= 0) { setError("Введите количество, например 150 или 1,5."); return; }
    try { onSavePortion({ mode, recipeUnit, text }, snapshotFor(item, recipeUnit, quantity)); setError(null); } catch (failure) { setError(nutritionErrorText(failure)); }
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.accentFill : "transparent" }]}>
      <View style={styles.cardRow}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${name}. ${sub}. ${open ? "Закрыть порцию" : "Открыть порцию"}`}
          onPress={onToggleOpen} style={styles.cardHead}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{sub}</Text>
          {selected && selectedLabel !== null ? <Text style={[styles.meta, { color: colors.accentInk }]}>{`В выборе: ${selectedLabel}`}</Text> : null}
        </Pressable>
        <Checkbox checked={selected} label={selected ? `Убрать из выбора: ${name}` : `Выбрать: ${name}`} onPress={onToggleSelect} />
      </View>
      {open ? <View style={styles.portion}>
        {item.kind === "RECIPE" && bases.length > 1 ? <SegmentedControl items={[{ id: "PORTION", label: "Порции" }, { id: "G", label: "Граммы" }]} selectedId={recipeUnit}
          onSelect={(next) => { setRecipeUnit(next); setText(next === "G" ? "100" : "1"); }} /> : null}
        {pieceMass !== null ? <SegmentedControl items={[{ id: "BASIS", label: "Граммы" }, { id: "PIECES", label: "Штуки" }]} selectedId={mode}
          onSelect={(next) => { setMode(next); setText(next === "PIECES" ? "1" : formatDecimalX10(basis.amountX10)); setError(null); }} /> : null}
        <TextField label={mode === "PIECES" ? "Количество, шт." : `Количество, ${unitLabels[basis.unit]}`} value={text}
          onChangeText={(next) => { setText(next); setError(null); }} keyboardType="decimal-pad" />
        {mode === "PIECES" && quantity !== null ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{`≈ ${formatDecimalX10(quantity)} г`}</Text> : null}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{preview === null ? " " : `Будет внесено: ${kcalText(preview)}`}</Text>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        <AppButton compact label={selected ? "Сохранить порцию" : "Выбрать с этой порцией"} onPress={save} />
        <View style={styles.actions}>
          <AppIconButton label={isFavorite(item) ? `Убрать из избранного: ${name}` : `В избранное: ${name}`}
            icon={<Star size={20} color={colors.accentInk} fill={isFavorite(item) ? colors.accentInk : "transparent"} />} onPress={() => onFavorite(item)} />
          {item.kind === "RECIPE" ? <>
            <AppButton compact variant="ghost" label="Изменить рецепт" onPress={() => onEditRecipe(item.recipe.id)} />
            <AppButton compact variant="ghost" label={item.recipe.inCookbook === true ? "Убрать из книги" : "В кулинарную книгу"} onPress={() => onCookbook(item.recipe)} />
          </> : null}
        </View>
      </View> : null}
    </View>
  );
}

/**
 * Добавление еды в приём пищи (§49.2, UX v1.1 NUT-FS-20…26): поиск и категории, чекбокс справа у каждой карточки, нажатие на карточку открывает порцию (запись в дневник
 * не создаётся), `Добавить (N)` записывает все выбранные позиции в выбранные приёмы одной транзакцией. Несколько приёмов дублируют позиции и требуют подтверждения `N × M`.
 */
export function AddFoodScreen({ clientId, localDate, slot, initialFilter = "ALL", foods, recipes, diary, onCreateFood, onCreateRecipe, onEditRecipe, onDirtyChange, onAdded }: Readonly<{
  clientId: string;
  localDate: string;
  slot: MealSlot;
  initialFilter?: CatalogFilter;
  foods: FoodCatalogPort;
  recipes: RecipeCatalogPort;
  diary: NutritionDiaryPort;
  onCreateFood: (name: string) => void;
  onCreateRecipe: () => void;
  onEditRecipe: (recipeId: string) => void;
  /** Есть несохранённый выбор — оболочка спросит «Отменить выбор?» при выходе. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Запись выполнена: вернуться в дневник. */
  onAdded?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picks, setPicks] = useState<Readonly<Record<string, SelectedPick & { readonly label: string }>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, PortionDraft>>>({});
  const [slots, setSlots] = useState<readonly MealSlot[]>([slot]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const lock = useRef(false);

  const selectedList = useMemo(() => Object.values(picks), [picks]);
  const plan = useMemo(() => planBatch(localDate, selectedList, slots), [localDate, selectedList, slots]);
  useEffect(() => { onDirtyChange?.(selectedList.length > 0); }, [onDirtyChange, selectedList.length]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<readonly Item[]> => {
      if (filter === "RECENT" || filter === "FREQUENT") {
        const today = todayLocal();
        const usage = rankUsage(await diary.listEntries(clientId, shiftDate(today, -USAGE_DAYS), today), filter === "RECENT" ? "recent" : "frequent", USAGE_LIMIT);
        const needle = query.trim().toLocaleLowerCase("ru");
        const resolved = await Promise.all(usage.map(async (used): Promise<Item | null> => {
          if (needle !== "" && !used.name.toLocaleLowerCase("ru").includes(needle)) return null;
          if (used.kind === "FOOD") { const food = await foods.get(used.id); return food === null || food.archivedAt !== null ? null : { kind: "FOOD", food }; }
          const recipe = await recipes.get(used.id);
          return recipe === null || recipe.archivedAt !== null ? null : { kind: "RECIPE", recipe };
        }));
        return resolved.filter((item): item is Item => item !== null);
      }
      const wantFoods = filter === "ALL" || filter === "FOODS" || filter === "FAVORITES";
      const wantRecipes = filter !== "FOODS";
      const [foodRows, recipeRows] = await Promise.all([wantFoods ? foods.search(query, filter === "FAVORITES" ? "FAVORITES" : "ALL") : [],
        wantRecipes ? recipes.search(query, filter === "FAVORITES" ? "FAVORITES" : filter === "COOKBOOK" ? "COOKBOOK" : "ALL") : []]);
      return [...recipeRows.map((recipe) => ({ kind: "RECIPE", recipe }) as const), ...foodRows.map((food) => ({ kind: "FOOD", food }) as const)];
    };
    void load().then((rows) => { if (active) { setItems(rows); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [foods, recipes, diary, clientId, query, filter, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offFoods = foods.subscribeCommittedChanges(refresh);
    const offRecipes = recipes.subscribeCommittedChanges(refresh);
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offFoods(); offRecipes(); offDiary(); };
  }, [foods, recipes, diary, clientId]);

  const quantityLabel = (snapshot: FoodSnapshot) => `${formatDecimalX10(snapshot.quantityX10)} ${unitLabels[snapshot.basis.unit]}`;
  const toggleSelect = useCallback((item: Item) => {
    const key = itemKey(item);
    setNotice(null);
    setPicks((current) => {
      if (current[key] !== undefined) return Object.fromEntries(Object.entries(current).filter(([other]) => other !== key));
      const snapshot = defaultSnapshot(item);
      return { ...current, [key]: { key, snapshot, label: quantityLabel(snapshot) } };
    });
  }, []);
  const savePortion = useCallback((item: Item, draft: PortionDraft, snapshot: FoodSnapshot) => {
    const key = itemKey(item);
    setDrafts((current) => ({ ...current, [key]: draft }));
    setPicks((current) => ({ ...current, [key]: { key, snapshot, label: quantityLabel(snapshot) } }));
    setOpenKey(null);
  }, []);
  const toggleSlot = (target: MealSlot) => setSlots((current) => current.includes(target) ? (current.length === 1 ? current : current.filter((value) => value !== target)) : [...current, target]);
  const clearSelection = () => { setPicks({}); setDrafts({}); setConfirm(null); setNotice(null); };

  const reportFailure = useCallback((failure: unknown) => setActionError(nutritionErrorText(failure)), []);
  const toggleFavorite = useCallback((item: Item) => {
    setActionError(null);
    const next = !isFavorite(item);
    void (item.kind === "FOOD" ? foods.setFavorite(item.food.id, next) : recipes.setFavorite(item.recipe.id, next)).catch(reportFailure);
  }, [foods, recipes, reportFailure]);
  const toggleCookbook = useCallback((recipe: Recipe) => {
    setActionError(null);
    void recipes.setInCookbook(recipe.id, recipe.inCookbook !== true).catch(reportFailure);
  }, [recipes, reportFailure]);

  /** Единая операция записи (NUT-FS-25): все записи или ни одной; замок от двойного нажатия, выбор сохраняется при ошибке. */
  const commit = async () => {
    setConfirm(null);
    if (lock.current || plan.total === 0) return;
    lock.current = true;
    setBusy(true);
    try {
      await diary.addEntries(clientId, plan.entries);
      setPicks({});
      setDrafts({});
      setActionError(null);
      setNotice(`Добавлено записей: ${plan.total}.`);
      onDirtyChange?.(false);
      onAdded?.();
    } catch (failure) {
      setActionError(nutritionErrorText(failure));
    }
    lock.current = false;
    setBusy(false);
  };
  const askCommit = () => { if (plan.needsConfirmation) setConfirm(plan.summary); else void commit(); };

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <View style={styles.topRow}>
          <Text style={[styles.meta, styles.grow, { color: colors.textSecondary }]}>{selectedList.length === 0 ? "Отметьте позиции галочкой справа" : `Выбрано: ${selectedList.length}`}</Text>
          {selectedList.length > 0 ? <>
            <AppButton compact variant="ghost" label="Очистить" disabled={busy} onPress={clearSelection} />
            <AppButton compact label={`Добавить (${selectedList.length})`} busy={busy} onPress={askCommit} accessibilityLabel={`Добавить выбранные позиции: ${selectedList.length}`} />
          </> : null}
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>В приёмы пищи</Text>
        <View style={styles.chips}>
          {MEAL_SLOTS.map((id) => <SelectionChip key={id} group="Приём пищи" label={slotLabels[id]} selected={slots.includes(id)} onPress={() => toggleSlot(id)} />)}
        </View>
        <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск продукта или рецепта" placeholder="Поиск продукта или рецепта" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          {filters.map((item) => <SelectionChip key={item.id} group="Категория" label={item.label} selected={filter === item.id} onPress={() => { setFilter(item.id); setOpenKey(null); }} />)}
        </ScrollView>
        {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
        {actionError !== null ? <InlineNotice kind="error">{actionError}</InlineNotice> : null}
        {failed ? <InlineNotice kind="error">Не удалось загрузить каталог.</InlineNotice> : null}
      </View>
      <FlatList data={items ?? []} keyExtractor={itemKey} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" extraData={`${openKey}|${Object.keys(picks).join(",")}`}
        ListHeaderComponent={<View style={styles.createRow}>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Создать продукт" onPress={() => onCreateFood(query.trim())} /></View>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Создать рецепт" onPress={onCreateRecipe} /></View>
        </View>}
        ListEmptyComponent={items === null ? null : <EmptyState reason={query.trim() === "" ? "no-data" : "no-match"}
          title={query.trim() === "" ? (filter === "ALL" ? "Каталог пока пуст" : "Здесь пока пусто") : "Ничего не найдено"}
          body={query.trim() === "" ? emptyBodies[filter] : "Измените запрос или создайте такой продукт."}
          action={{ label: "Создать продукт", onPress: () => onCreateFood(query.trim()) }} />}
        renderItem={({ item }) => {
          const key = itemKey(item);
          return <ItemCard item={item} selected={picks[key] !== undefined} selectedLabel={picks[key]?.label ?? null} draft={drafts[key]} open={openKey === key}
            onToggleOpen={() => setOpenKey(openKey === key ? null : key)} onToggleSelect={() => toggleSelect(item)} onSavePortion={(draft, snapshot) => savePortion(item, draft, snapshot)}
            onEditRecipe={onEditRecipe} onFavorite={toggleFavorite} onCookbook={toggleCookbook} />;
        }} />
      <ConfirmDialog visible={confirm !== null} title="Добавить в несколько приёмов?" confirmLabel="Добавить" onCancel={() => setConfirm(null)} onConfirm={() => { void commit(); }}
        description={`${confirm ?? ""}. Каждая позиция будет записана в каждый выбранный приём: это дубли. Операция выполняется целиком или не выполняется.`} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, borderWidth: 2, padding: 14, gap: 8 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardHead: { flex: 1, gap: 2, minHeight: 48, justifyContent: "center" },
  checkHit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  checkBox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  portion: { gap: 8 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  createRow: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipsRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
});
