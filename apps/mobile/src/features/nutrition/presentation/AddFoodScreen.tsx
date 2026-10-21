import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown, Star } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState, ScreenHeader, SearchField, SegmentedControl, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type MealSlot } from "../domain/DiaryModel.ts";
import type { FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import { formatDecimalX10, gramsFromPieces, parseDecimalX10 } from "../domain/FoodRules.ts";
import { snapshotOfFood, snapshotOfRecipe, type FoodSnapshot } from "../domain/FoodSnapshot.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { RecipeCatalogPort } from "../domain/RecipeCatalogPort.ts";
import type { Recipe } from "../domain/RecipeModel.ts";
import { recipeBases } from "../domain/RecipeRules.ts";
import { planBatch, type SelectedPick } from "../domain/SelectionRules.ts";
import type { SavedMeal, SavedMealInput } from "../domain/SavedMeal.ts";
import { SavedMealEditorDialog } from "./SavedMealEditorDialog.tsx";
import { sumNutrients } from "../domain/DiaryRules.ts";
import { browseRecipes, EMPTY_RECIPE_FILTERS, type RecipeFilters, type RecipeSort } from "../domain/RecipeBrowse.ts";
import { RecipeBrowseControls } from "./RecipeBrowseControls.tsx";
import { catalogKey, pickSnapshot, usageFromSummaries, type CatalogItem, type PortionDraft } from "../domain/CatalogPick.ts";
import { basisText, kcalText, nutritionErrorText, slotLabels, todayLocal, unitLabels } from "./nutritionFormat.ts";

type Item = CatalogItem;
/** Категории каталога (P-25). «Недавние» и «Частые» — производное чтение дневника клиента, без отдельного хранилища. */
export type CatalogFilter = "ALL" | "RECENT" | "FREQUENT" | "FAVORITES" | "FOODS" | "RECIPES" | "COOKBOOK" | "SAVED";
const filters: readonly Readonly<{ id: CatalogFilter; label: string }>[] = [{ id: "COOKBOOK", label: "Кулинарная книга" }, { id: "RECIPES", label: "Рецепты" },
  { id: "FOODS", label: "Еда" }, { id: "RECENT", label: "Недавние" }, { id: "FREQUENT", label: "Частые" }, { id: "SAVED", label: "Сохранённая еда" },
  { id: "FAVORITES", label: "Избранное" }, { id: "ALL", label: "Все" }];
const USAGE_LIMIT = 50;
const emptyBodies: Readonly<Record<CatalogFilter, string>> = {
  ALL: "Здесь появятся ваши продукты и рецепты. Создайте первый продукт.", RECENT: "Недавно добавленных позиций у этого клиента пока нет.",
  FREQUENT: "Частые позиции появятся после нескольких записей в дневнике.", FAVORITES: "Отметьте продукт или рецепт звёздочкой — он появится здесь.",
  FOODS: "Продуктов пока нет. Создайте первый.", RECIPES: "Рецептов пока нет. Создайте первый.", COOKBOOK: "Добавьте рецепт в кулинарную книгу — он появится здесь.", SAVED: "У этого клиента ещё нет сохранённых наборов." };
const isFavorite = (item: Item) => (item.kind === "FOOD" ? item.food.favorite : item.recipe.favorite) === true;
const itemName = (item: Item) => item.kind === "FOOD" ? item.food.name : item.recipe.name;

/** Снимок для позиции и количества. */
function snapshotFor(item: Item, recipeUnit: "PORTION" | "G", quantityX10: number): FoodSnapshot {
  return item.kind === "FOOD" ? snapshotOfFood(item.food, quantityX10) : snapshotOfRecipe(item.recipe, recipeUnit, quantityX10);
}

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

function ItemCard({ item, selected, selectedLabel, draft, open, onToggleOpen, onToggleSelect, onSavePortion, onDraftChange, onEditFood, onEditRecipe, onFavorite, onCookbook }: Readonly<{ item: Item; selected: boolean; selectedLabel: string | null;
  draft: PortionDraft | undefined; open: boolean; onToggleOpen: () => void; onToggleSelect: () => void; onSavePortion: (draft: PortionDraft, snapshot: FoodSnapshot) => void;
  onDraftChange: (draft: PortionDraft) => void;
  onEditFood: (foodId: string) => void;
  onEditRecipe: (recipeId: string) => void; onFavorite: (item: Item) => void; onCookbook: (recipe: Recipe) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const bases = item.kind === "RECIPE" ? recipeBases(item.recipe) : [];
  const [recipeUnit, setRecipeUnit] = useState<"PORTION" | "G">(draft?.recipeUnit ?? (item.kind === "RECIPE" && item.suggested?.basis.unit === "G" && item.recipe.cookedMassX10 !== null ? "G" : "PORTION"));
  const basis = item.kind === "FOOD" ? { unit: item.food.unit, amountX10: item.food.amountX10 }
    : (bases.find((candidate) => candidate.basis.unit === recipeUnit) ?? bases[0]!).basis;
  const pieceMass = item.kind === "FOOD" && item.food.unit === "G" ? (item.food.gramsPerPieceX10 ?? null) : null;
  const [mode, setMode] = useState<"BASIS" | "PIECES">(draft?.mode ?? "BASIS");
  const [text, setText] = useState(() => draft?.text ?? formatDecimalX10(pickSnapshot(item).quantityX10));
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
  const star = <AppIconButton compact label={isFavorite(item) ? `Убрать из избранного: ${name}` : `В избранное: ${name}`}
    icon={<Star size={20} color={colors.accentInk} fill={isFavorite(item) ? colors.accentInk : "transparent"} />} onPress={() => onFavorite(item)} />;
  if (item.kind === "FOOD") {
    const unitText = mode === "PIECES" ? unitLabels.PIECE : unitLabels[basis.unit];
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.accentFill : "transparent" }]}>
        <View style={styles.cardRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${name}. ${sub}. Изменить продукт`} onPress={() => onEditFood(item.food.id)} style={styles.cardHead}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
            <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{sub}</Text>
            {selected && selectedLabel !== null ? <Text style={[styles.meta, { color: colors.accentInk }]}>{`В выборе: ${selectedLabel}`}</Text> : null}
          </Pressable>
          <View style={styles.qtyBox}>
            <TextField compact hideLabel label={`Количество, ${unitText}`} value={text} keyboardType="decimal-pad"
              onChangeText={(next) => { setText(next); setError(null); onDraftChange({ mode, recipeUnit, text: next }); }} />
          </View>
          {pieceMass !== null ? <Pressable accessibilityRole="button" accessibilityLabel={mode === "PIECES" ? "Единица: штуки. Переключить на граммы" : "Единица: граммы. Переключить на штуки"} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            onPress={() => { const next = mode === "PIECES" ? "BASIS" : "PIECES"; const value = next === "PIECES" ? "1" : formatDecimalX10(basis.amountX10); setMode(next); setText(value); setError(null); onDraftChange({ mode: next, recipeUnit, text: value }); }}>
            <Text style={[styles.unitToggle, { color: colors.accentInk }]}>{unitText}</Text>
          </Pressable> : <Text style={[styles.unitToggle, { color: colors.textSecondary }]}>{unitText}</Text>}
          {star}
          <Checkbox checked={selected} label={selected ? `Убрать из выбора: ${name}` : `Выбрать: ${name}`} onPress={onToggleSelect} />
        </View>
        {error !== null ? <Text style={[styles.meta, { color: colors.danger }]}>{error}</Text> : null}
        {preview === null && text.trim() !== "" ? <Text style={[styles.meta, { color: colors.danger }]}>Введите количество, например 150 или 1,5.</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.accentFill : "transparent" }]}>
      <View style={styles.cardRow}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${name}. ${sub}. ${open ? "Закрыть порцию" : "Открыть порцию"}`}
          onPress={onToggleOpen} style={styles.cardHead}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{sub}</Text>
          {selected && selectedLabel !== null ? <Text style={[styles.meta, { color: colors.accentInk }]}>{`В выборе: ${selectedLabel}`}</Text> : null}
        </Pressable>
        {star}
        <Checkbox checked={selected} label={selected ? `Убрать из выбора: ${name}` : `Выбрать: ${name}`} onPress={onToggleSelect} />
      </View>
      {open ? <View style={styles.portion}>
        {item.kind === "RECIPE" ? <>
          {item.recipe.details?.photoUri ? <Image source={{ uri: item.recipe.details.photoUri }} accessibilityLabel={`Фото: ${item.recipe.name}`} style={styles.recipePhoto} /> : null}
          {item.recipe.description ? <Text style={[styles.meta, { color: colors.textPrimary }]}>{item.recipe.description}</Text> : null}
          {item.recipe.details?.categories.length ? <Text style={[styles.meta, { color: colors.accentInk }]}>{item.recipe.details.categories.join(" · ")}</Text> : null}
          {item.recipe.ingredients.map((ingredient) => <Text key={ingredient.food.id} style={[styles.meta, { color: colors.textSecondary }]}>{`${ingredient.food.name} · ${formatDecimalX10(ingredient.quantityX10)} ${unitLabels[ingredient.food.unit]}`}</Text>)}
          {item.recipe.details?.steps.map((instruction, index) => <Text key={index} style={[styles.meta, { color: colors.textPrimary }]}>{`${index + 1}. ${instruction}`}</Text>)}
        </> : null}
        {item.kind === "RECIPE" && bases.length > 1 ? <SegmentedControl items={[{ id: "PORTION", label: "Порции" }, { id: "G", label: "Граммы" }]} selectedId={recipeUnit}
          onSelect={(next) => { const value = next === "G" ? "100" : "1"; setRecipeUnit(next); setText(value); onDraftChange({ mode, recipeUnit: next, text: value }); }} /> : null}
        {pieceMass !== null ? <SegmentedControl items={[{ id: "BASIS", label: "Граммы" }, { id: "PIECES", label: "Штуки" }]} selectedId={mode}
          onSelect={(next) => { const value = next === "PIECES" ? "1" : formatDecimalX10(basis.amountX10); setMode(next); setText(value); setError(null); onDraftChange({ mode: next, recipeUnit, text: value }); }} /> : null}
        <TextField label={mode === "PIECES" ? "Количество, шт." : `Количество, ${unitLabels[basis.unit]}`} value={text}
          onChangeText={(next) => { setText(next); setError(null); onDraftChange({ mode, recipeUnit, text: next }); }} keyboardType="decimal-pad" />
        {mode === "PIECES" && quantity !== null ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{`≈ ${formatDecimalX10(quantity)} г`}</Text> : null}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{preview === null ? " " : `Будет внесено: ${kcalText(preview)}`}</Text>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        <AppButton compact label={selected ? "Сохранить порцию" : "Выбрать с этой порцией"} onPress={save} />
        <View style={styles.actions}>
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
export function AddFoodScreen({ clientId, localDate, slot, initialFilter = "FOODS", foods, recipes, diary, onCreateFood, onCreateRecipe, onEditFood, onEditRecipe, onDirtyChange, onAdded, onBack }: Readonly<{
  clientId: string;
  localDate: string;
  slot: MealSlot;
  initialFilter?: CatalogFilter;
  foods: FoodCatalogPort;
  recipes: RecipeCatalogPort;
  diary: NutritionDiaryPort;
  onCreateFood: (name: string) => void;
  onCreateRecipe: () => void;
  onEditFood: (foodId: string) => void;
  onEditRecipe: (recipeId: string) => void;
  /** Есть несохранённый выбор — оболочка спросит «Отменить выбор?» при выходе. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Запись выполнена: вернуться в дневник. */
  onAdded?: () => void;
  /** Стрелка «назад» собственной шапки экрана. */
  onBack: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [itemsScope, setItemsScope] = useState<CatalogFilter | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picks, setPicks] = useState<Readonly<Record<string, SelectedPick & { readonly label: string }>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, PortionDraft>>>({});
  const [invalidDrafts, setInvalidDrafts] = useState<Readonly<Record<string, boolean>>>({});
  const [slots, setSlots] = useState<readonly MealSlot[]>([slot]);
  const [selectingSlots, setSelectingSlots] = useState(false);
  const [multipleSlots, setMultipleSlots] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<readonly string[]>([]);
  const [savedMeals, setSavedMeals] = useState<readonly SavedMeal[]>([]);
  const [mealsFailed, setMealsFailed] = useState(false);
  const [selectedMeals, setSelectedMeals] = useState<Readonly<Record<string, SavedMeal>>>({});
  const [mealEditor, setMealEditor] = useState<Readonly<{ meal?: SavedMeal; name?: string; snapshots: readonly FoodSnapshot[] }> | null>(null);
  const [buildingMeal, setBuildingMeal] = useState(false);
  const [buildingBase, setBuildingBase] = useState<SavedMealInput>({ name: "", snapshots: [] });
  const [buildingTarget, setBuildingTarget] = useState<SavedMeal | undefined>(undefined);
  const selectionBackup = useRef<Readonly<{ picks: typeof picks; drafts: typeof drafts; invalidDrafts: typeof invalidDrafts; selectedMeals: typeof selectedMeals }> | null>(null);
  const [recipeFilters, setRecipeFilters] = useState<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const [recipeSort, setRecipeSort] = useState<RecipeSort>("DEFAULT");
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [showSelection, setShowSelection] = useState(false);
  const listRef = useRef<FlatList<Item>>(null);
  const scrollPositions = useRef<Partial<Record<CatalogFilter, number>>>({});
  const restoreScroll = useRef(true);
  const primarySlot = slots[0] ?? slot;
  const recipeGrid = filter === "RECIPES" || filter === "COOKBOOK";
  const hasRecipeFilters = recipeGrid && (recipeFilters.calories !== "ANY" || recipeFilters.time !== "ANY" || Object.values(recipeFilters.macros).some((range) => range.min !== 0 || range.max !== 100));
  const lock = useRef(false);
  const pendingCommand = useRef<Readonly<{ payload: string; id: string }> | null>(null);

  const selectedList = useMemo(() => [...Object.values(picks), ...Object.values(selectedMeals).flatMap((meal) => meal.snapshots.map((snapshot, index) =>
    ({ key: `m:${meal.id}:${index}`, snapshot, label: meal.name })))], [picks, selectedMeals]);
  const selectedCount = Object.keys(picks).length + Object.keys(selectedMeals).length;
  const visibleItems = useMemo(() => itemsScope !== filter ? [] : filter === "RECIPES" || filter === "COOKBOOK"
    ? browseRecipes((items ?? []).flatMap((item) => item.kind === "RECIPE" ? [item.recipe] : []), recipeFilters, recipeSort).map((recipe): Item => ({ kind: "RECIPE", recipe }))
    : filter === "RECENT" && !recentExpanded ? (items ?? []).filter((item, index, all) => item.usageSlot !== primarySlot || all.slice(0, index).filter((other) => other.usageSlot === primarySlot).length < 4)
    : items ?? [], [items, itemsScope, filter, recipeFilters, recipeSort, recentExpanded, primarySlot]);
  const plan = useMemo(() => planBatch(localDate, selectedList, slots), [localDate, selectedList, slots]);
  useEffect(() => { onDirtyChange?.(selectedList.length > 0 || buildingMeal || Object.keys(drafts).length > 0); }, [onDirtyChange, selectedList.length, buildingMeal, drafts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(query);
      const text = query.trim();
      if (text === "") setActionError(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let active = true;
    void diary.listSearchQueries(clientId).then((history) => { if (active) setSearchHistory(history); }, () => undefined);
    return () => { active = false; };
  }, [clientId, diary]);
  const rememberedQuery = useRef("");
  const rememberQuery = (text = query) => {
    const normalized = text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
    // Один запрос — одна запись истории: повторные отметки позиций в том же поиске не пишут в БД.
    if (normalized === "" || normalized === rememberedQuery.current) return;
    rememberedQuery.current = normalized;
    void diary.rememberSearchQuery(clientId, text).then(() => diary.listSearchQueries(clientId)).then(setSearchHistory,
      () => setActionError("Не удалось сохранить историю поиска. Выбор еды сохранён."));
  };
  useEffect(() => {
    let active = true;
    void diary.listSavedMeals(clientId).then((meals) => { if (active) { setSavedMeals(meals); setMealsFailed(false); } }, () => { if (active) setMealsFailed(true); });
    return () => { active = false; };
  }, [diary, clientId, tick]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<readonly Item[]> => {
      if (filter === "RECENT" || filter === "FREQUENT") {
        const today = todayLocal();
        const usage = usageFromSummaries(await diary.listUsageSummaries(clientId, primarySlot, today), filter === "RECENT" ? "recent" : "frequent", USAGE_LIMIT);
        const needle = searchQuery.trim().toLocaleLowerCase("ru");
        const resolved = await Promise.all(usage.map(async (used): Promise<Item | null> => {
          if (needle !== "" && !used.name.toLocaleLowerCase("ru").includes(needle)) return null;
          if (used.kind === "FOOD") { const food = await foods.get(used.id); return food === null || food.archivedAt !== null ? null : { kind: "FOOD", food, suggested: used.snapshot, usageSlot: used.slot }; }
          const recipe = await recipes.get(used.id);
          return recipe === null || recipe.archivedAt !== null ? null : { kind: "RECIPE", recipe, suggested: used.snapshot, usageSlot: used.slot };
        }));
        return resolved.filter((item): item is Item => item !== null);
      }
      if (filter === "SAVED") return [];
      const wantFoods = filter === "ALL" || filter === "FOODS" || filter === "FAVORITES";
      const wantRecipes = filter !== "FOODS";
      const [foodRows, recipeRows] = await Promise.all([wantFoods ? foods.search(searchQuery, filter === "FAVORITES" ? "FAVORITES" : "ALL") : [],
        wantRecipes ? recipes.search(searchQuery, filter === "FAVORITES" ? "FAVORITES" : filter === "COOKBOOK" ? "COOKBOOK" : "ALL") : []]);
      return [...recipeRows.map((recipe) => ({ kind: "RECIPE", recipe }) as const), ...foodRows.map((food) => ({ kind: "FOOD", food }) as const)];
    };
    void load().then((rows) => { if (active) { setItems(rows); setItemsScope(filter); setFailed(false); } }, () => { if (active) { setFailed(true); setItemsScope(filter); setItems([]); } });
    return () => { active = false; };
  }, [foods, recipes, diary, clientId, searchQuery, filter, tick, primarySlot]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offFoods = foods.subscribeCommittedChanges(refresh);
    const offRecipes = recipes.subscribeCommittedChanges(refresh);
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId && change.scope !== "WATER") refresh(); });
    const offMeals = diary.subscribeSavedMealChanges((id) => { if (id === clientId) refresh(); });
    return () => { offFoods(); offRecipes(); offDiary(); offMeals(); };
  }, [foods, recipes, diary, clientId]);

  const quantityLabel = (snapshot: FoodSnapshot) => `${formatDecimalX10(snapshot.quantityX10)} ${unitLabels[snapshot.basis.unit]}`;
  const toggleSelect = useCallback((item: Item) => {
    const key = catalogKey(item);
    setNotice(null);
    if (picks[key] !== undefined) {
      setPicks((current) => Object.fromEntries(Object.entries(current).filter(([other]) => other !== key)));
      setInvalidDrafts((current) => ({ ...current, [key]: false }));
      return;
    }
    try {
      const snapshot = pickSnapshot(item, drafts[key]);
      setPicks((current) => ({ ...current, [key]: { key, snapshot, label: quantityLabel(snapshot) } }));
      setActionError(null);
    } catch (failure) { setOpenKey(key); setActionError(nutritionErrorText(failure)); }
  }, [drafts, picks]);
  const changeDraft = (item: Item, draft: PortionDraft) => {
    const key = catalogKey(item);
    setDrafts((current) => ({ ...current, [key]: draft }));
    if (picks[key] === undefined) return;
    try {
      const snapshot = pickSnapshot(item, draft);
      setPicks((current) => ({ ...current, [key]: { key, snapshot, label: quantityLabel(snapshot) } }));
      setInvalidDrafts((current) => ({ ...current, [key]: false }));
    } catch { setInvalidDrafts((current) => ({ ...current, [key]: true })); }
  };
  const savePortion = useCallback((item: Item, draft: PortionDraft, snapshot: FoodSnapshot) => {
    const key = catalogKey(item);
    setDrafts((current) => ({ ...current, [key]: draft }));
    setInvalidDrafts((current) => ({ ...current, [key]: false }));
    setPicks((current) => ({ ...current, [key]: { key, snapshot, label: quantityLabel(snapshot) } }));
    setOpenKey(null);
    setDetailItem(null);
  }, []);
  const toggleSlot = (target: MealSlot) => setSlots((current) => current.includes(target) ? (current.length === 1 ? current : current.filter((value) => value !== target)) : [...current, target]);
  const clearSelection = () => { setPicks({}); setSelectedMeals({}); setDrafts({}); setInvalidDrafts({}); setConfirm(null); setNotice(null); };
  const beginBuilding = (input: SavedMealInput = { name: "", snapshots: [] }, meal?: SavedMeal) => {
    if (!buildingMeal) selectionBackup.current = { picks, drafts, invalidDrafts, selectedMeals };
    clearSelection(); setBuildingBase(input); setBuildingTarget(meal); setMealEditor(null); setBuildingMeal(true); setFilter("FOODS"); setQuery("");
  };
  const endBuilding = (updated?: SavedMeal) => {
    const backup = selectionBackup.current;
    if (backup !== null) {
      setPicks(backup.picks); setDrafts(backup.drafts); setInvalidDrafts(backup.invalidDrafts);
      setSelectedMeals(updated !== undefined && backup.selectedMeals[updated.id] !== undefined ? { ...backup.selectedMeals, [updated.id]: updated } : backup.selectedMeals);
    }
    selectionBackup.current = null; setBuildingMeal(false); setBuildingBase({ name: "", snapshots: [] }); setBuildingTarget(undefined); setFilter("SAVED");
  };

  const reportFailure = useCallback((failure: unknown) => setActionError(nutritionErrorText(failure)), []);
  const toggleFavorite = useCallback((item: Item) => {
    setActionError(null);
    const next = !isFavorite(item);
    void (item.kind === "FOOD" ? foods.setFavorite(item.food.id, next).then((food) => {
      setDetailItem((current) => current?.kind === "FOOD" && current.food.id === food.id ? { ...current, food } : current);
    }) : recipes.setFavorite(item.recipe.id, next).then((recipe) => {
      setDetailItem((current) => current?.kind === "RECIPE" && current.recipe.id === recipe.id ? { ...current, recipe } : current);
    })).catch(reportFailure);
  }, [foods, recipes, reportFailure]);
  const toggleCookbook = useCallback((recipe: Recipe) => {
    setActionError(null);
    void recipes.setInCookbook(recipe.id, recipe.inCookbook !== true).then((updated) => {
      setDetailItem((current) => current?.kind === "RECIPE" && current.recipe.id === updated.id ? { ...current, recipe: updated } : current);
    }).catch(reportFailure);
  }, [recipes, reportFailure]);

  /** Единая операция записи (NUT-FS-25): все записи или ни одной; замок от двойного нажатия, выбор сохраняется при ошибке. */
  const commit = async () => {
    setConfirm(null);
    if (lock.current || plan.total === 0 || Object.values(invalidDrafts).some(Boolean)) return;
    lock.current = true;
    setBusy(true);
    try {
      const payload = JSON.stringify(plan.entries);
      if (pendingCommand.current?.payload !== payload) pendingCommand.current = { payload, id: `nutrition:${Date.now()}:${Math.random().toString(36).slice(2)}` };
      await diary.addEntries(clientId, plan.entries, new Date(), pendingCommand.current.id);
      setPicks({});
      setSelectedMeals({});
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
  const openSelected = async (snapshot: FoodSnapshot) => {
    try {
      const item: Item | null = snapshot.source.kind === "FOOD"
        ? await foods.get(snapshot.source.id).then((food) => food === null ? null : { kind: "FOOD", food })
        : await recipes.get(snapshot.source.id).then((recipe) => recipe === null ? null : { kind: "RECIPE", recipe });
      if (item === null) { setActionError("Источник позиции недоступен. Сохранённая порция остаётся в выборе."); return; }
      setShowSelection(false); setDetailItem(item);
    } catch (failure) { setActionError(nutritionErrorText(failure)); }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScreenHeader onBack={onBack} right={selectedList.length > 0 ? <View style={styles.topRow}>
        <AppButton compact variant="ghost" label="Очистить" disabled={busy} onPress={clearSelection} />
        <AppButton compact label={`✓ (${selectedCount})`} busy={busy} disabled={buildingMeal || Object.values(invalidDrafts).some(Boolean)} onPress={askCommit} accessibilityLabel={`Добавить выбранные позиции: ${selectedCount}, записей: ${plan.total}`} />
      </View> : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Приём пищи: ${slots.length > 1 ? `${slots.length} приёма` : slotLabels[slots[0] ?? slot]}. Выбрать целевой приём пищи`} style={[styles.grow, styles.mealSelector]} onPress={() => setSelectingSlots(true)}>
          <View style={styles.mealTitleRow}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{slots.length > 1 ? `${slots.length} приёма пищи` : slotLabels[slots[0] ?? slot]}</Text>
            <ChevronDown size={18} color={colors.textPrimary} />
          </View>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{localDate}</Text>
        </Pressable>
      </ScreenHeader>
      <View style={styles.header}>
        <SegmentedControl scroll compact items={filters} selectedId={filter} onSelect={(id) => { restoreScroll.current = true; setFilter(id); setOpenKey(null); }} />
        <SearchField query={query} onChangeQuery={(text) => { restoreScroll.current = false; setQuery(text); }} onSubmitSearch={() => rememberQuery()} accessibilityLabel="Поиск продукта или рецепта" placeholder="Поиск продукта или рецепта" />
        {filter === "RECIPES" || filter === "COOKBOOK" ? <RecipeBrowseControls filters={recipeFilters} sort={recipeSort} onFilters={setRecipeFilters} onSort={setRecipeSort} /> : null}
        {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
        {actionError !== null ? <InlineNotice kind="error">{actionError}</InlineNotice> : null}
        {Object.values(invalidDrafts).some(Boolean) ? <InlineNotice kind="error">Исправьте количество выбранной позиции или снимите её флажок.</InlineNotice> : null}
        {failed ? <InlineNotice kind="error">Не удалось загрузить каталог.</InlineNotice> : null}
      </View>
      {buildingMeal ? <View style={styles.header}><Text style={[styles.meta, { color: colors.textPrimary }]}>Выберите продукты и рецепты для нового набора.</Text>
        <AppButton compact label={`Сохранить состав (${buildingBase.snapshots.length + selectedList.length})`} disabled={(selectedList.length === 0 && buildingBase.snapshots.length === 0) || Object.values(invalidDrafts).some(Boolean)} onPress={() => setMealEditor({ meal: buildingTarget, name: buildingBase.name, snapshots: [...buildingBase.snapshots, ...selectedList.map((pick) => pick.snapshot)] })} />
        <AppButton compact variant="ghost" label="Отменить создание набора" onPress={() => endBuilding()} /></View> : null}
      {filter === "SAVED" ? <FlatList data={savedMeals.filter((meal) => meal.name.toLocaleLowerCase("ru").includes(searchQuery.trim().toLocaleLowerCase("ru")))} keyExtractor={(meal) => meal.id}
        contentContainerStyle={styles.list} extraData={selectedMeals} keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<><AppButton compact variant="secondary" label="Новая сохранённая еда" onPress={() => beginBuilding()} />
          {mealsFailed ? <><InlineNotice kind="error">Не удалось загрузить сохранённую еду.</InlineNotice><AppButton compact label="Повторить загрузку наборов" onPress={() => setTick((value) => value + 1)} /></> : null}</>}
        ListEmptyComponent={<EmptyState reason="no-data" title="Наборов нет" body={emptyBodies.SAVED} />}
        renderItem={({ item: meal }) => <View style={[styles.card, styles.cardRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable style={styles.cardHead} accessibilityRole="button" accessibilityLabel={`Изменить набор: ${meal.name}`} onPress={() => setMealEditor({ meal, snapshots: meal.snapshots })}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{meal.name}</Text><Text style={[styles.meta, { color: colors.textSecondary }]}>{`${meal.snapshots.length} позиций · ${kcalText(sumNutrients(meal.snapshots.map((snapshot) => snapshot.eaten)))}`}</Text>
          </Pressable>
          <Checkbox checked={selectedMeals[meal.id] !== undefined} label={`Выбрать набор: ${meal.name}`} onPress={() => setSelectedMeals((current) => current[meal.id] === undefined ? { ...current, [meal.id]: meal } : Object.fromEntries(Object.entries(current).filter(([id]) => id !== meal.id)))} />
        </View>} /> : <FlatList ref={listRef} key={filter} data={visibleItems} keyExtractor={catalogKey} numColumns={recipeGrid ? 2 : 1}
        columnWrapperStyle={recipeGrid ? styles.recipeColumns : undefined} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" extraData={`${openKey}|${Object.keys(picks).join(",")}`}
        onScroll={(event) => { if (!restoreScroll.current) scrollPositions.current[filter] = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={100}
        onContentSizeChange={() => { if (restoreScroll.current && itemsScope === filter) { listRef.current?.scrollToOffset({ offset: scrollPositions.current[filter] ?? 0, animated: false }); restoreScroll.current = false; } }}
        ListHeaderComponent={<>{filter === "COOKBOOK" || !recipeGrid ? <View style={styles.createRow}>
          {filter === "COOKBOOK" ? <View style={styles.grow}><AppButton compact variant="secondary" label="Создать рецепт" onPress={onCreateRecipe} /></View>
            : <View style={styles.grow}><AppButton compact variant="secondary" label="Создать продукт" onPress={() => onCreateFood(query.trim())} /></View>}
        </View> : null}{filter === "RECENT" ? <View style={styles.portion}><Text style={[styles.title, { color: colors.textPrimary }]}>{`Недавние · ${slotLabels[primarySlot]}`}</Text>
          <AppButton compact variant="ghost" label={recentExpanded ? `Свернуть ${slotLabels[primarySlot]}` : `Развернуть ${slotLabels[primarySlot]}`} onPress={() => setRecentExpanded(!recentExpanded)} />
        </View> : null}{query.trim() === "" && filter === "FOODS" && searchHistory.length > 0 ? <View>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>История поиска</Text>
          {searchHistory.map((text) => <Pressable key={text} style={styles.historyRow} accessibilityRole="button" accessibilityLabel={`Повторить поиск: ${text}`} onPress={() => { setQuery(text); rememberQuery(text); }}>
            <Text style={[styles.meta, { color: colors.textPrimary }]}>{`↶  ${text}  ↖`}</Text></Pressable>)}
        </View> : null}</>}
        ListEmptyComponent={itemsScope !== filter ? <LoadingState label="Загружаем каталог…" /> : failed ? <AppButton variant="secondary" label="Повторить загрузку" onPress={() => setTick((value) => value + 1)} /> : <EmptyState reason={query.trim() === "" && !hasRecipeFilters ? "no-data" : "no-match"}
          title={hasRecipeFilters ? "Нет рецептов по этим условиям" : query.trim() === "" ? (filter === "ALL" ? "Каталог пока пуст" : "Здесь пока пусто") : "Ничего не найдено"}
          body={hasRecipeFilters ? "Измените фильтры или поисковый запрос." : query.trim() === "" ? emptyBodies[filter] : "Измените запрос или создайте свою позицию."}
          action={recipeGrid ? (hasRecipeFilters ? { label: "Сбросить фильтры", onPress: () => setRecipeFilters(EMPTY_RECIPE_FILTERS) } : filter === "COOKBOOK" ? { label: "Создать рецепт", onPress: onCreateRecipe } : undefined) : { label: "Создать продукт", onPress: () => onCreateFood(query.trim()) }} />}
        renderItem={({ item, index }) => {
          const key = catalogKey(item);
          if (recipeGrid && item.kind === "RECIPE") {
            const minutes = item.recipe.details?.prepMinutes != null && item.recipe.details.cookMinutes !== null ? item.recipe.details.prepMinutes + item.recipe.details.cookMinutes : null;
            return <View style={[styles.recipeTile, { backgroundColor: colors.surface }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Открыть рецепт: ${item.recipe.name}`} onPress={() => setDetailItem(item)} style={styles.portion}>
                {item.recipe.details?.photoUri ? <Image source={{ uri: item.recipe.details.photoUri }} style={styles.recipeTilePhoto} accessibilityLabel={`Фото: ${item.recipe.name}`} />
                  : <View style={[styles.recipeTilePhoto, styles.photoPlaceholder, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.meta, { color: colors.textSecondary }]}>Рецепт без фото</Text></View>}
                <Text style={[styles.title, { color: colors.textPrimary }]}>{item.recipe.name}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${minutes === null ? "Время не указано" : `${minutes} мин`} · ${kcalText(recipeBases(item.recipe)[0]!.nutrients)}`}</Text>
              </Pressable>
              <View style={styles.cardRow}><Text style={[styles.meta, styles.grow, { color: colors.accentInk }]}>{picks[key]?.label ?? "1 порция"}</Text><Checkbox checked={picks[key] !== undefined} label={`Выбрать: ${item.recipe.name}`} onPress={() => toggleSelect(item)} /></View>
            </View>;
          }
          const otherHeading = filter === "RECENT" && item.usageSlot !== primarySlot && (index === 0 || visibleItems[index - 1]?.usageSlot === primarySlot);
          return <View>{otherHeading ? <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Все остальные блюда</Text> : null}<ItemCard key={`${key}:${openKey === key ? "open" : "closed"}`} item={item} selected={picks[key] !== undefined} selectedLabel={picks[key]?.label ?? null} draft={drafts[key]} open={openKey === key}
            onDraftChange={(draft) => changeDraft(item, draft)}
            onToggleOpen={() => setOpenKey(openKey === key ? null : key)} onToggleSelect={() => { toggleSelect(item); rememberQuery(); }} onSavePortion={(draft, snapshot) => { savePortion(item, draft, snapshot); rememberQuery(); }}
            onEditFood={onEditFood} onEditRecipe={onEditRecipe} onFavorite={toggleFavorite} onCookbook={toggleCookbook} /></View>;
        }} />}
      {selectedCount > 0 && !buildingMeal ? <View style={[styles.selectionBar, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <AppButton compact variant="ghost" label={`Выбрано: ${selectedCount} · ${plan.total} записей`} onPress={() => setShowSelection(true)} />
      </View> : null}
      <Modal visible={showSelection} transparent animationType="slide" onRequestClose={() => setShowSelection(false)}>
        <View style={styles.detailBackdrop}><View style={[styles.detailPanel, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Выбранная еда</Text>
          <ScrollView keyboardShouldPersistTaps="handled">{Object.values(picks).map((pick) => <View key={pick.key} style={styles.cardRow}>
            <Pressable accessibilityRole="button" style={styles.cardHead} accessibilityLabel={`Изменить выбранную порцию: ${pick.snapshot.name}`} onPress={() => { void openSelected(pick.snapshot); }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{pick.snapshot.name}</Text><Text style={[styles.meta, { color: colors.textSecondary }]}>{pick.label}</Text>
            </Pressable>
            <Checkbox checked label={`Убрать из выбора: ${pick.snapshot.name}`} onPress={() => { setPicks((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== pick.key))); setInvalidDrafts((current) => ({ ...current, [pick.key]: false })); }} />
          </View>)}{Object.values(selectedMeals).map((meal) => <View key={meal.id} style={styles.cardRow}>
            <Text style={[styles.title, styles.grow, { color: colors.textPrimary }]}>{`${meal.name} · ${meal.snapshots.length} позиций`}</Text>
            <Checkbox checked label={`Убрать набор из выбора: ${meal.name}`} onPress={() => setSelectedMeals((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== meal.id)))} />
          </View>)}</ScrollView>
          <AppButton variant="ghost" label="Закрыть выбранное" onPress={() => setShowSelection(false)} />
        </View></View>
      </Modal>
      <Modal visible={selectingSlots} transparent animationType="fade" onRequestClose={() => setSelectingSlots(false)}>
        <View style={styles.detailBackdrop}><View style={[styles.detailPanel, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Куда добавить еду</Text>
          <View style={styles.chips}>{MEAL_SLOTS.map((id) => <SelectionChip key={id} group="Приём пищи" label={slotLabels[id]} selected={slots.includes(id)}
            onPress={() => { if (multipleSlots) toggleSlot(id); else setSlots([id]); }} />)}</View>
          <AppButton variant="secondary" label={multipleSlots ? "Выбрать один приём" : "Добавить в несколько приёмов"} onPress={() => { if (multipleSlots) setSlots([primarySlot]); setMultipleSlots(!multipleSlots); }} />
          {multipleSlots ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${plan.summary}. Каждая позиция будет продублирована.`}</Text> : null}
          <AppButton label="Готово" onPress={() => setSelectingSlots(false)} />
        </View></View>
      </Modal>
      <Modal visible={detailItem !== null} transparent animationType="slide" onRequestClose={() => setDetailItem(null)}>
        <View style={styles.detailBackdrop}><View style={[styles.detailPanel, { backgroundColor: colors.surface }]}>
          <ScrollView keyboardShouldPersistTaps="handled">{detailItem !== null ? <ItemCard key={catalogKey(detailItem)} item={detailItem} selected={picks[catalogKey(detailItem)] !== undefined}
            selectedLabel={picks[catalogKey(detailItem)]?.label ?? null} draft={drafts[catalogKey(detailItem)]} open onToggleOpen={() => setDetailItem(null)}
            onToggleSelect={() => toggleSelect(detailItem)} onDraftChange={(draft) => changeDraft(detailItem, draft)} onSavePortion={(draft, snapshot) => savePortion(detailItem, draft, snapshot)}
            onEditFood={(id) => { setDetailItem(null); onEditFood(id); }} onEditRecipe={(id) => { setDetailItem(null); onEditRecipe(id); }} onFavorite={toggleFavorite} onCookbook={toggleCookbook} /> : null}</ScrollView>
          <AppButton variant="ghost" label="Вернуться к выбору" onPress={() => setDetailItem(null)} />
        </View></View>
      </Modal>
      {mealEditor !== null ? <SavedMealEditorDialog meal={mealEditor.meal} initialName={mealEditor.name} snapshots={mealEditor.snapshots} onClose={() => setMealEditor(null)}
        onAddItems={(input) => beginBuilding(input, mealEditor.meal)}
        onSave={async (input) => {
          const meal = mealEditor.meal === undefined ? await diary.createSavedMeal(clientId, input) : await diary.updateSavedMeal(clientId, mealEditor.meal.id, mealEditor.meal.revision, input);
          setSelectedMeals((current) => current[meal.id] === undefined ? current : { ...current, [meal.id]: meal });
          if (buildingMeal) endBuilding(meal);
          setFilter("SAVED");
        }} onDelete={mealEditor.meal === undefined ? undefined : async () => {
          const meal = mealEditor.meal!; await diary.removeSavedMeal(clientId, meal.id, meal.revision);
          setSelectedMeals((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== meal.id)));
        }} /> : null}
      <ConfirmDialog visible={confirm !== null} title="Добавить в несколько приёмов?" confirmLabel="Добавить" onCancel={() => setConfirm(null)} onConfirm={() => { void commit(); }}
        description={`${confirm ?? ""}. Каждая позиция будет записана в каждый выбранный приём: это дубли. Операция выполняется целиком или не выполняется.`} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  mealTitleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  mealSelector: { minHeight: 44, justifyContent: "center" },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 2 },
  card: { ...shadow.card, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  historyRow: { minHeight: 44, justifyContent: "center" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBox: { width: 64 },
  unitToggle: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, minWidth: 22 },
  cardHead: { flex: 1, gap: 2, minHeight: 48, justifyContent: "center" },
  checkHit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  checkBox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  portion: { gap: 8 },
  recipePhoto: { width: "100%", height: 180, borderRadius: 12 },
  recipeColumns: { gap: 8 },
  recipeTile: { flex: 1, maxWidth: "49%", padding: 8, marginBottom: 8, borderRadius: 12 },
  recipeTilePhoto: { width: "100%", aspectRatio: 1, borderRadius: 10 },
  photoPlaceholder: { justifyContent: "center", alignItems: "center" },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 14, paddingVertical: 14 },
  detailBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  detailPanel: { maxHeight: "90%", padding: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 },
  selectionBar: { paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  createRow: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
