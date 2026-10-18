import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Dumbbell, Plus, SlidersHorizontal, Star, X } from "lucide-react-native";
import { AppButton, FilterPill, FloatingActionButton, InlineNotice, LoadingState, SearchField,
  SelectionChip } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { bodyPartLabels, equipmentLabel, trackingProfileLabels } from "../domain/ExerciseLabels.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS } from "../domain/ExerciseModel.ts";
import { activeFilterCount, displayNameOf, filterCatalog, NO_FILTERS, type CatalogEntry, type CatalogFilters,
  type CatalogMode } from "../domain/ExerciseRules.ts";
import { thumbnailOf } from "./exerciseImage.ts";
import { useExerciseCatalog } from "./useExerciseCatalog.ts";

const modes: readonly Readonly<{ id: CatalogMode; label: string }>[] = [
  { id: "ALL", label: "Все" }, { id: "FAVORITES", label: "Избранное" }, { id: "MINE", label: "Мои" },
];

/** Частое оборудование для фильтра; остальное находится поиском. */
export const COMMON_EQUIPMENT: readonly string[] = ["none", "barbell", "dumbbell", "kettlebell", "cable", "smith_machine",
  "ez_bar", "plates", "pull_up_bar", "dip_station", "rings", "resistance_band", "loop_band", "suspension_trainer",
  "stability_ball", "flat_bench", "leg_press"];

export function equipmentFilterLabel(id: string): string { return id === "none" ? "Без оборудования" : equipmentLabel(id); }

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function ExerciseRow({ entry, onPress }: Readonly<{ entry: CatalogEntry; onPress: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { definition, overlay } = entry;
  const meta = [bodyPartLabels[definition.bodyPart], equipmentLabel(definition.equipment),
    trackingProfileLabels[definition.trackingProfile]].join(" · ");
  const name = displayNameOf(entry);
  const thumbnail = thumbnailOf(definition.media);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}. ${meta}${overlay.favorite ? ". В избранном" : ""}`}
      onPress={onPress} style={({ pressed }) => [styles.row, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: overlay.hidden ? 0.55 : 1 }]}>
      <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
        {thumbnail !== null ? <Image source={thumbnail} style={styles.thumbImage} accessibilityIgnoresInvertColors />
          : <Dumbbell size={18} color={colors.accentInk} strokeWidth={1.8} />}
      </View>
      <View style={styles.grow}>
        <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{name}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{meta}</Text>
      </View>
      {overlay.favorite ? <Star size={16} color={colors.accentInk} fill={colors.accentInk} strokeWidth={1.8} /> : null}
      {definition.origin === "CUSTOM" ? <Text style={[styles.badge, { color: colors.accentInk, borderColor: colors.border }]}>Моё</Text> : null}
      <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.8} />
    </Pressable>
  );
}

/** §31.6 Фильтры в нижнем окне: группа мышц, оборудование, профиль учёта, скрытые. */
function FiltersSheet({ visible, filters, onChange, onClose }: Readonly<{
  visible: boolean; filters: CatalogFilters; onChange: (next: CatalogFilters) => void; onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheetModal>(null);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props}
    appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []);
  useEffect(() => {
    if (!visible) { sheet.current?.dismiss(); return undefined; }
    sheet.current?.present();
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => back.remove();
  }, [visible, onClose]);
  return (
    <BottomSheetModal ref={sheet} snapPoints={["85%"]} enableDynamicSizing={false} onDismiss={onClose}
      backdropComponent={backdrop} backgroundStyle={{ backgroundColor: colors.canvas, borderRadius: 12 }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}>
      <View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]}>
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.textPrimary }]}>Фильтры</Text>
        <BottomSheetScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={[styles.group, { color: colors.textPrimary }]}>Группа мышц</Text>
          <View style={styles.chips}>
            {BODY_PARTS.map((part) => <SelectionChip key={part} group="Группа мышц" label={bodyPartLabels[part]}
              selected={filters.bodyParts.has(part)} onPress={() => onChange({ ...filters, bodyParts: toggled(filters.bodyParts, part) })} />)}
          </View>
          <Text style={[styles.group, { color: colors.textPrimary }]}>Оборудование</Text>
          <View style={styles.chips}>
            {COMMON_EQUIPMENT.map((item) => <SelectionChip key={item} group="Оборудование" label={equipmentFilterLabel(item)}
              selected={filters.equipment.has(item)} onPress={() => onChange({ ...filters, equipment: toggled(filters.equipment, item) })} />)}
          </View>
          <Text style={[styles.group, { color: colors.textPrimary }]}>Как записывается подход</Text>
          <View style={styles.chips}>
            {TRACKING_PROFILE_IDS.map((profile) => <SelectionChip key={profile} group="Учёт" label={trackingProfileLabels[profile]}
              selected={filters.profiles.has(profile)} onPress={() => onChange({ ...filters, profiles: toggled(filters.profiles, profile) })} />)}
          </View>
          <View style={styles.chips}>
            <SelectionChip group="Скрытые" label="Показывать скрытые" selected={filters.showHidden}
              onPress={() => onChange({ ...filters, showHidden: !filters.showHidden })} />
          </View>
        </BottomSheetScrollView>
        <View style={styles.sheetActions}>
          <View style={styles.grow}><AppButton variant="secondary" label="Сбросить" onPress={() => onChange(NO_FILTERS)} /></View>
          <View style={styles.grow}><AppButton label="Готово" onPress={onClose} /></View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

/**
 * Каталог упражнений (§31): поиск сразу, быстрые режимы, фильтры в нижнем окне и снимаемые метки
 * активных фильтров, плотный список. Нет совпадений — «Создать «запрос»».
 */
export function ExerciseLibraryScreen({ repository, onOpen, onCreate, picking = false }: Readonly<{
  repository: ExerciseCatalogPort;
  /** Каталог: открыть карточку; выбор: вернуть упражнение (§31.9 один каталог, разные режимы). */
  onOpen: (exerciseId: string) => void;
  onCreate: (name: string) => void;
  picking?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { entries, failed, reload } = useExerciseCatalog(repository);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CatalogMode>("ALL");
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shown = useMemo(() => entries === null ? [] : filterCatalog(entries, query, mode, filters), [entries, filters, mode, query]);
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
  const count = activeFilterCount(filters);

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.top}>
        <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск упражнения"
          placeholder="Название или синоним" />
        <View style={styles.pills}>
          {modes.map((item) => <FilterPill key={item.id} label={item.label} accessibilityLabel={`Показать: ${item.label}`}
            selected={mode === item.id} onPress={() => setMode(item.id)} />)}
          <FilterPill label={count > 0 ? `Фильтры · ${count}` : "Фильтры"} accessibilityLabel="Открыть фильтры" selected={count > 0}
            icon={(color) => <SlidersHorizontal size={16} color={color} strokeWidth={1.8} />} onPress={() => setFiltersOpen(true)} />
        </View>
        {chips.length > 0 ? (
          <View style={styles.chipRow}>
            {chips.map((chip) => (
              <Pressable key={chip.key} accessibilityRole="button" accessibilityLabel={`Снять фильтр: ${chip.label}`}
                onPress={chip.remove} style={[styles.activeChip, { borderColor: colors.accentInk }]}>
                <Text style={[styles.activeChipText, { color: colors.accentInk }]}>{chip.label}</Text>
                <X size={14} color={colors.accentInk} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <FlatList data={shown} keyExtractor={(entry) => entry.definition.id} keyboardShouldPersistTaps="handled"
        initialNumToRender={16} windowSize={9} contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <ExerciseRow entry={item} onPress={() => onOpen(item.definition.id)} />}
        ListHeaderComponent={<Text style={[styles.counter, { color: colors.textMuted }]}>
          {picking ? `Выберите упражнение · найдено: ${shown.length}` : `Найдено: ${shown.length}`}</Text>}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {mode === "MINE" && query.trim() === "" ? "Своих упражнений пока нет." : "Ничего не найдено."}
            </Text>
            {query.trim() !== "" ? (
              <AppButton variant="secondary" label={`Создать «${query.trim()}»`} onPress={() => onCreate(query.trim())} />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <Pressable accessibilityRole="link" accessibilityLabel={meta.attribution} onPress={() => { void Linking.openURL("https://repdb.co"); }}>
            <Text style={[styles.attribution, { color: colors.textMuted }]}>{meta.attribution}</Text>
          </Pressable>
        } />
      {picking ? null : <FloatingActionButton label="Создать своё упражнение" icon={(color) => <Plus size={26} color={color} strokeWidth={2} />}
        onPress={() => onCreate(query.trim())} />}
      <FiltersSheet visible={filtersOpen} filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  top: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  activeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, minHeight: 48 },
  activeChipText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  listContent: { paddingBottom: 96, paddingHorizontal: 16, gap: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 12, paddingVertical: 10,
    minHeight: 64, borderWidth: 1, borderRadius: 12 },
  thumb: { width: 48, height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImage: { width: 48, height: 48 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  badge: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  empty: { padding: 16, gap: 12 },
  attribution: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center", padding: 16 },
  sheet: { flex: 1, paddingTop: 8, gap: 8 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, paddingHorizontal: 16 },
  sheetBody: { padding: 16, gap: 10 },
  group: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetActions: { flexDirection: "row", gap: 10, paddingHorizontal: 16 },
});
