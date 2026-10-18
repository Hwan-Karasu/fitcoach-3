import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, FlatList, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronRight, Dumbbell, Plus, SlidersHorizontal, Star, X } from "lucide-react-native";
import { AppButton, FilterPill, FloatingActionButton, InlineNotice, LoadingState, SearchField,
  SelectionChip } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { bodyPartLabels, equipmentLabel, trackingProfileLabels } from "../domain/ExerciseLabels.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS } from "../domain/ExerciseModel.ts";
import { displayNameOf, filterCatalog, filterOptionCounts, NO_FILTERS, type CatalogEntry, type CatalogFilters,
  type CatalogMode } from "../domain/ExerciseRules.ts";
import { EquipmentGlyph } from "./equipmentGlyphs.tsx";
import { BodyPartIcon } from "./exerciseIcons.tsx";
import { thumbnailOf } from "./exerciseImage.ts";
import { useExerciseCatalog } from "./useExerciseCatalog.ts";

const modes: readonly Readonly<{ id: CatalogMode; label: string }>[] = [
  { id: "ALL", label: "Все" }, { id: "FAVORITES", label: "Избранное" }, { id: "MINE", label: "Мои" },
];

/** Частое оборудование для фильтра; остальное находится поиском. */
export const COMMON_EQUIPMENT: readonly string[] = ["none", "barbell", "dumbbell", "kettlebell", "cable", "smith_machine",
  "ez_bar", "plates", "pull_up_bar", "dip_station", "rings", "resistance_band", "loop_band", "suspension_trainer",
  "stability_ball", "flat_bench", "leg_press"];

/** Подпись варианта фильтра — с заглавной буквы (в строке упражнения оборудование идёт строчными). */
export function equipmentFilterLabel(id: string): string {
  if (id === "none") return "Без оборудования";
  const label = equipmentLabel(id);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

/**
 * `order` — номер в выборе нескольких упражнений (UI-OWN-029); `null` — не отмечено. Звёздочка — избранное
 * прямо из списка (UI-OWN-030); `favorite` — значение до перечитывания каталога.
 */
const ExerciseRow = memo(function ExerciseRow({ entry, onPressId, order, favorite, onFavoriteEntry }: Readonly<{
  entry: CatalogEntry; onPressId: (id: string) => void; order: number | null; favorite: boolean;
  onFavoriteEntry: (entry: CatalogEntry) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { definition, overlay } = entry;
  const meta = [bodyPartLabels[definition.bodyPart], equipmentLabel(definition.equipment),
    trackingProfileLabels[definition.trackingProfile]].join(" · ");
  const name = displayNameOf(entry);
  const thumbnail = thumbnailOf(definition.media);
  return (
    <Pressable accessibilityRole="button" accessibilityState={order === null ? undefined : { selected: true }}
      accessibilityLabel={`${name}. ${meta}${favorite ? ". В избранном" : ""}${order === null ? "" : `. Выбрано, номер ${order}`}`}
      onPress={() => onPressId(definition.id)} style={({ pressed }) => [styles.row, { borderColor: order === null ? colors.border : colors.accentInk,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: overlay.hidden ? 0.55 : 1 }]}>
      <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
        {thumbnail !== null ? <Image source={thumbnail} style={styles.thumbImage} accessibilityIgnoresInvertColors />
          : <Dumbbell size={18} color={colors.accentInk} strokeWidth={1.8} />}
      </View>
      <View style={styles.grow}>
        <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{name}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{meta}</Text>
      </View>
      {definition.origin === "CUSTOM" ? <Text style={[styles.badge, { color: colors.accentInk, borderColor: colors.border }]}>Моё</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={favorite ? `Убрать из избранного: ${name}` : `В избранное: ${name}`}
        accessibilityState={{ selected: favorite }} hitSlop={6} onPress={() => onFavoriteEntry(entry)} style={styles.star}>
        <Star size={20} color={favorite ? colors.accentInk : colors.textMuted} fill={favorite ? colors.accentInk : "transparent"}
          strokeWidth={1.8} />
      </Pressable>
      {order !== null ? (
        <View style={[styles.order, { backgroundColor: colors.accentFill }]}>
          <Text style={[styles.orderText, { color: colors.onAccentFill }]}>{order}</Text>
        </View>
      ) : <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.8} />}
    </Pressable>
  );
});

type SheetKind = "muscles" | "equipment" | "more";

/**
 * Нижнее окно каталога (§31.6): закрывается «Готово», «Назад» Android, жестом вниз и нажатием на подложку.
 * Обычное окно внутри экрана, не модальное: у BottomSheetModal общая очередь на приложение, и повторное
 * закрытие уже закрытого окна оставляло его «закрывающимся» — второй раз фильтр не открывался.
 */
function CatalogSheet({ visible, title, onClose, onReset, children }: Readonly<{
  visible: boolean; title: string; onClose: () => void; onReset: () => void; children: ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props}
    appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []);
  useEffect(() => {
    if (!visible) { sheet.current?.close(); return undefined; }
    sheet.current?.snapToIndex(0);
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => back.remove();
  }, [visible, onClose]);
  return (
    <BottomSheet ref={sheet} index={-1} snapPoints={["88%"]} enableDynamicSizing={false} enablePanDownToClose onClose={onClose}
      backdropComponent={backdrop} backgroundStyle={{ backgroundColor: colors.canvas, borderRadius: 12 }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}>
      <View style={[styles.sheet, { paddingBottom: 8 + insets.bottom }]}>
        <View style={styles.sheetHead}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, styles.grow, { color: colors.textPrimary }]}>{title}</Text>
          <AppButton compact variant="ghost" label="Сбросить" onPress={onReset} />
          <AppButton compact label="Готово" onPress={onClose} />
        </View>
        <BottomSheetScrollView contentContainerStyle={styles.sheetBody}>{children}</BottomSheetScrollView>
      </View>
    </BottomSheet>
  );
}

/**
 * Вариант фильтра — плитка сетки в 3 колонки (UI-OWN-031): крупный значок (силуэт тела или оборудование),
 * подпись и число упражнений с учётом остальных фильтров. Выбранная — акцентная рамка и галочка; фон светлый,
 * чтобы силуэт оставался виден.
 */
function OptionTile({ icon, label, count, selected, onPress, compact = false }: Readonly<{
  icon: (color: string) => ReactNode; label: string; count: number; selected: boolean; onPress: () => void;
  /** Оборудование: значок меньше силуэта — плитка ниже, мышцы не меняются. */
  compact?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${label}, упражнений: ${count}`}
      onPress={onPress} style={({ pressed }) => [styles.tile, compact ? styles.tileCompact : null, {
        borderColor: selected ? colors.accentInk : colors.border, borderWidth: selected ? 2 : 1,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: count === 0 && !selected ? 0.45 : 1 }]}>
      <View style={[styles.tileIcon, compact ? styles.tileIconCompact : null]}>{icon(selected ? colors.accentInk : colors.textSecondary)}</View>
      <Text numberOfLines={2} style={[styles.tileLabel, { color: selected ? colors.accentInk : colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.tileCount, { color: colors.textMuted }]}>{count}</Text>
      {selected ? <View style={[styles.tileCheck, { backgroundColor: colors.accentFill }]}>
        <Check size={12} color={colors.onAccentFill} strokeWidth={3} />
      </View> : null}
    </Pressable>
  );
}

/**
 * Каталог упражнений (§31): поиск сразу, быстрые режимы, фильтры в нижнем окне и снимаемые метки
 * активных фильтров, плотный список. Нет совпадений — «Создать «запрос»». В выборе для тренировки можно
 * отметить несколько упражнений: номер на строке — порядок добавления (UI-OWN-029).
 */
export function ExerciseLibraryScreen({ repository, onOpen, onPick, onCreate, picking = false, multiPick = false }: Readonly<{
  repository: ExerciseCatalogPort;
  /** Каталог: открыть карточку (§31.9 один каталог, разные режимы). */
  onOpen?: (exerciseId: string) => void;
  /** Выбор: вернуть упражнения в порядке выбора (одно — при замене). */
  onPick?: (exerciseIds: readonly string[]) => void;
  /** `selected` — уже отмеченные, чтобы созданное упражнение встало после них. */
  onCreate: (name: string, selected: readonly string[]) => void;
  picking?: boolean;
  multiPick?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { entries, failed, reload } = useExerciseCatalog(repository);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CatalogMode>("ALL");
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Одно нижнее окно на экран: несколько BottomSheetModal путались у провайдера. Содержимое держится, пока окно уезжает.
  const [lastSheet, setLastSheet] = useState<SheetKind>("muscles");
  useEffect(() => { if (sheet !== null) setLastSheet(sheet); }, [sheet]);
  const kind = sheet ?? lastSheet;
  // Звёздочка отвечает сразу; каталог перечитается после записи и сотрёт это.
  const [favorites, setFavorites] = useState<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => { setFavorites(new Map()); }, [entries]);
  const toggleFavorite = (entry: CatalogEntry) => {
    const next = !(favorites.get(entry.definition.id) ?? entry.overlay.favorite);
    setFavorites((current) => new Map(current).set(entry.definition.id, next));
    void repository.setFavorite(entry.definition.id, next).catch(() => setFavorites((current) => {
      const copy = new Map(current); copy.delete(entry.definition.id); return copy;
    }));
  };
  const [selected, setSelected] = useState<readonly string[]>([]);
  const press = (exerciseId: string) => {
    if (multiPick) {
      setSelected((current) => current.includes(exerciseId) ? current.filter((id) => id !== exerciseId) : [...current, exerciseId]);
    } else if (picking) onPick?.([exerciseId]);
    else onOpen?.(exerciseId);
  };
  // Окно фильтров отвечает сразу, список догоняет: пересчёт и отрисовка списка — с отложенными значениями.
  const listQuery = useDeferredValue(query);
  const listFilters = useDeferredValue(filters);
  const shown = useMemo(() => entries === null ? [] : filterCatalog(entries, listQuery, mode, listFilters),
    [entries, listFilters, mode, listQuery]);
  const actions = useRef({ press, toggleFavorite });
  actions.current = { press, toggleFavorite };
  const onPressId = useCallback((id: string) => actions.current.press(id), []);
  const onFavoriteEntry = useCallback((entry: CatalogEntry) => actions.current.toggleFavorite(entry), []);
  const renderRow = useCallback(({ item }: Readonly<{ item: CatalogEntry }>) => {
    const index = selected.indexOf(item.definition.id);
    return <ExerciseRow entry={item} onPressId={onPressId} order={index < 0 ? null : index + 1}
      favorite={favorites.get(item.definition.id) ?? item.overlay.favorite} onFavoriteEntry={onFavoriteEntry} />;
  }, [favorites, onFavoriteEntry, onPressId, selected]);
  const optionCounts = useMemo(() => entries === null || kind === "more" ? new Map<string, number>()
    : filterOptionCounts(entries, query, mode, filters, kind === "muscles" ? "bodyParts" : "equipment"), [entries, filters, mode, query, kind]);
  const meta = repository.meta();

  if (entries === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        {failed ? <>
          <InlineNotice kind="error">Каталог не загрузился.</InlineNotice>
          <AppButton variant="secondary" label="Повторить" onPress={reload} />
        </> : <LoadingState label="Открываем каталог…" />}
      </View>
    );
  }

  const chips = [
    ...[...filters.bodyParts].map((part) => ({ key: `b:${part}`, label: bodyPartLabels[part],
      remove: () => setFilters({ ...filters, bodyParts: toggled(filters.bodyParts, part) }) })),
    ...[...filters.equipment].map((item) => ({ key: `e:${item}`, label: equipmentFilterLabel(item),
      remove: () => setFilters({ ...filters, equipment: toggled(filters.equipment, item) }) })),
    ...[...filters.profiles].map((profile) => ({ key: `p:${profile}`, label: trackingProfileLabels[profile],
      remove: () => setFilters({ ...filters, profiles: toggled(filters.profiles, profile) }) })),
    ...(filters.showHidden ? [{ key: "hidden", label: "Со скрытыми", remove: () => setFilters({ ...filters, showHidden: false }) }] : []),
  ];
  const moreCount = filters.profiles.size + (filters.showHidden ? 1 : 0);
  const summary = (picked: readonly string[], all: string) => picked.length === 0 ? all
    : picked.length === 1 ? picked[0]! : `${picked[0]} +${picked.length - 1}`;
  const muscleLabel = summary([...filters.bodyParts].map((part) => bodyPartLabels[part]), "Все мышцы");
  const equipmentPicked = summary([...filters.equipment].map(equipmentFilterLabel), "Всё оборудование");
  const equipmentOptions = [...new Set([...COMMON_EQUIPMENT, ...optionCounts.keys(), ...filters.equipment])]
    .filter((item) => (optionCounts.get(item) ?? 0) > 0 || filters.equipment.has(item))
    .sort((a, b) => (optionCounts.get(b) ?? 0) - (optionCounts.get(a) ?? 0));

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.top}>
        <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск упражнения"
          placeholder="Название или синоним" />
        {/* Два главных фильтра — во всю ширину (как в Hevy); режимы и редкие фильтры — строкой ниже (UI-OWN-030). */}
        <View style={styles.pills}>
          <FilterPill grow menu expanded={sheet === "muscles"} selected={filters.bodyParts.size > 0} label={muscleLabel}
            accessibilityLabel={`Группа мышц: ${muscleLabel}`} onPress={() => setSheet("muscles")} />
          <FilterPill grow menu expanded={sheet === "equipment"} selected={filters.equipment.size > 0} label={equipmentPicked}
            accessibilityLabel={`Оборудование: ${equipmentPicked}`} onPress={() => setSheet("equipment")} />
        </View>
        <View style={styles.pills}>
          {modes.map((item) => <FilterPill key={item.id} label={item.label} accessibilityLabel={`Показать: ${item.label}`}
            selected={mode === item.id} onPress={() => setMode(item.id)}
            icon={item.id === "FAVORITES" ? (color) => <Star size={14} color={color} strokeWidth={2} /> : undefined} />)}
          <FilterPill label={moreCount > 0 ? `Ещё · ${moreCount}` : "Ещё"} accessibilityLabel="Ещё фильтры" selected={moreCount > 0}
            icon={(color) => <SlidersHorizontal size={14} color={color} strokeWidth={1.8} />} onPress={() => setSheet("more")} />
        </View>
        {chips.length > 0 ? (
          // Снимаемые метки — одной строкой с горизонтальной прокруткой, видимая высота 30 (UI-OWN-030).
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {chips.map((chip) => (
              <Pressable key={chip.key} accessibilityRole="button" accessibilityLabel={`Снять фильтр: ${chip.label}`}
                onPress={chip.remove} hitSlop={{ top: 9, bottom: 9 }}
                style={[styles.activeChip, { borderColor: colors.accentInk }]}>
                <Text style={[styles.activeChipText, { color: colors.accentInk }]}>{chip.label}</Text>
                <X size={13} color={colors.accentInk} strokeWidth={2} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View style={styles.listArea}>
      <FlatList data={shown} keyExtractor={(entry) => entry.definition.id} keyboardShouldPersistTaps="handled"
        initialNumToRender={16} windowSize={9} contentContainerStyle={styles.listContent}
        renderItem={renderRow}
        ListHeaderComponent={<Text style={[styles.counter, { color: colors.textMuted }]}>
          {multiPick ? `Отмечайте по порядку — так они встанут в тренировку · найдено: ${shown.length}`
            : picking ? `Выберите упражнение · найдено: ${shown.length}` : `Найдено: ${shown.length}`}</Text>}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {mode === "MINE" && query.trim() === "" ? "Своих упражнений пока нет." : "Ничего не найдено."}
            </Text>
            {query.trim() !== "" ? (
              <AppButton variant="secondary" label={`Создать «${query.trim()}»`} onPress={() => onCreate(query.trim(), selected)} />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <Pressable accessibilityRole="link" accessibilityLabel={meta.attribution} onPress={() => { void Linking.openURL("https://repdb.co"); }}>
            <Text style={[styles.attribution, { color: colors.textMuted }]}>{meta.attribution}</Text>
          </Pressable>
        } />
      {/* Своё упражнение — и при выборе для тренировки; кнопка над панелью «Добавить (N)» (UI-OWN-030). */}
      <FloatingActionButton label="Создать своё упражнение" text="Своё упражнение"
        icon={(color) => <Plus size={20} color={color} strokeWidth={2.2} />} onPress={() => onCreate(query.trim(), selected)} />
      </View>
      {multiPick && selected.length > 0 ? (
        <View style={[styles.pickBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Сбросить" onPress={() => setSelected([])} /></View>
          <View style={styles.pickMain}><AppButton compact label={`Добавить (${selected.length})`}
            accessibilityLabel={`Добавить в тренировку: ${selected.length}`} onPress={() => onPick?.(selected)} /></View>
        </View>
      ) : null}
      <CatalogSheet visible={sheet !== null} onClose={closeSheet}
        title={kind === "muscles" ? "Группа мышц" : kind === "equipment" ? "Оборудование" : "Ещё фильтры"}
        onReset={kind === "muscles" ? () => setFilters({ ...filters, bodyParts: new Set() })
          : kind === "equipment" ? () => setFilters({ ...filters, equipment: new Set() })
          : () => setFilters({ ...filters, profiles: new Set(), showHidden: false })}>
        {kind === "muscles" ? <>
        <View style={styles.optionWrap}>
        {BODY_PARTS.map((part) => <OptionTile key={part} icon={() => <BodyPartIcon part={part} />} label={bodyPartLabels[part]} count={optionCounts.get(part) ?? 0}
          selected={filters.bodyParts.has(part)} onPress={() => setFilters({ ...filters, bodyParts: toggled(filters.bodyParts, part) })} />)}
        </View>
        </> : kind === "equipment" ? <>
        <View style={styles.optionWrap}>
        {equipmentOptions.map((item) => <OptionTile key={item} compact icon={(color) => <EquipmentGlyph id={item} color={color} size={28} />} label={equipmentFilterLabel(item)} count={optionCounts.get(item) ?? 0}
          selected={filters.equipment.has(item)} onPress={() => setFilters({ ...filters, equipment: toggled(filters.equipment, item) })} />)}
        </View>
        </> : <>
        <Text style={[styles.group, { color: colors.textPrimary }]}>Как записывается подход</Text>
        <View style={styles.chips}>
          {TRACKING_PROFILE_IDS.map((profile) => <SelectionChip key={profile} group="Учёт" label={trackingProfileLabels[profile]}
            selected={filters.profiles.has(profile)} onPress={() => setFilters({ ...filters, profiles: toggled(filters.profiles, profile) })} />)}
        </View>
        <Text style={[styles.group, { color: colors.textPrimary }]}>Скрытые упражнения</Text>
        <View style={styles.chips}>
          <SelectionChip group="Скрытые" label="Показывать скрытые" selected={filters.showHidden}
            onPress={() => setFilters({ ...filters, showHidden: !filters.showHidden })} />
        </View>
        </>}
      </CatalogSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listArea: { flex: 1 },
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  top: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipScroll: { flexGrow: 0, marginHorizontal: -16 },
  chipRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16 },
  activeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, height: 30 },
  activeChipText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  listContent: { paddingBottom: 96, paddingHorizontal: 16, gap: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 12, paddingVertical: 10,
    minHeight: 64, borderWidth: 1, borderRadius: 12 },
  thumb: { width: 48, height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImage: { width: 48, height: 48 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  badge: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 13, borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  empty: { padding: 16, gap: 12 },
  attribution: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, textAlign: "center", padding: 16 },
  sheet: { flex: 1, paddingTop: 8, gap: 8 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  sheetBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 6 },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31.6%", minHeight: 136, borderRadius: 12, alignItems: "center", paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4, gap: 2 },
  tileIcon: { height: 86, alignItems: "center", justifyContent: "center" },
  tileCompact: { minHeight: 84, paddingTop: 6, paddingBottom: 6 },
  tileIconCompact: { height: 36 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center" },
  tileCount: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  tileCheck: { position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  star: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  group: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetActions: { flexDirection: "row", gap: 10, paddingHorizontal: 16 },
  order: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  orderText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16 },
  pickBar: { flexDirection: "row", gap: 8, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  pickMain: { flex: 2 },
});
