import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { TrackingProfileId } from "../domain/ExerciseModel.ts";

/**
 * Плитки выбора каталога (UI-OWN-031/032): общие для фильтров и редактора своего упражнения. `count` — число
 * упражнений у варианта в фильтре; без него (редактор) число не показывается и плитка не бледнеет.
 */

/** Пример записи подхода — чтобы способ учёта узнавался без чтения определений (UI-OWN-032). */
export const profileExamples: Readonly<Record<TrackingProfileId, string>> = {
  REPS: "12 повт.", LOAD_REPS: "60 кг × 10", ADDED_LOAD_REPS: "+10 кг × 8", ASSISTANCE_REPS: "−20 кг × 8", DURATION: "0:45",
  REPS_DURATION: "20 за 1:00", DISTANCE_DURATION: "2 км · 10:00", LOAD_DISTANCE: "24 кг · 40 м", LOAD_DURATION: "20 кг · 0:30",
};

const faded = (count: number | undefined, selected: boolean) => count === 0 && !selected ? 0.45 : 1;

/**
 * Плитка 3 в ряд: крупный значок (силуэт тела или оборудование), подпись, число. Выбранная — акцентная рамка и
 * галочка; фон светлый, чтобы силуэт оставался виден. `radio` — одиночный выбор (редактор).
 */
export function OptionTile({ icon, label, count, selected, onPress, compact = false, radio = false, dimWhenEmpty = true }: Readonly<{
  dimWhenEmpty?: boolean;
  icon: (color: string) => ReactNode; label: string; count?: number; selected: boolean; onPress: () => void;
  /** Оборудование: значок меньше силуэта — плитка ниже, мышцы не меняются. */
  compact?: boolean;
  radio?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole={radio ? "radio" : "checkbox"} accessibilityState={radio ? { selected } : { checked: selected }}
      accessibilityLabel={count === undefined ? label : `${label}, упражнений: ${count}`}
      onPress={onPress} style={({ pressed }) => [styles.tile, compact ? styles.tileCompact : null, {
        borderColor: selected ? colors.accentInk : colors.border, borderWidth: selected ? 2 : 1,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: dimWhenEmpty ? faded(count, selected) : 1 }]}>
      <View style={[styles.tileIcon, compact ? styles.tileIconCompact : null]}>{icon(selected ? colors.accentInk : colors.textSecondary)}</View>
      <Text numberOfLines={2} style={[styles.tileLabel, { color: selected ? colors.accentInk : colors.textPrimary }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text> : null}
      {selected ? <View style={[styles.tileCheck, { backgroundColor: colors.accentFill }]}>
        <Check size={12} color={colors.onAccentFill} strokeWidth={3} />
      </View> : null}
    </Pressable>
  );
}

/** Способ записи подхода — плитка 3 в ряд (9 вариантов — сетка 3×3): название, пример записи, число. */
export function ProfileTile({ label, example, count, selected, onPress, radio = false }: Readonly<{
  label: string; example: string; count?: number; selected: boolean; onPress: () => void; radio?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole={radio ? "radio" : "checkbox"} accessibilityState={radio ? { selected } : { checked: selected }}
      accessibilityLabel={`${label}, например ${example}${count === undefined ? "" : `, упражнений: ${count}`}`} onPress={onPress}
      style={({ pressed }) => [styles.profileTile, { borderColor: selected ? colors.accentInk : colors.border, borderWidth: selected ? 2 : 1,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: faded(count, selected) }]}>
      <View style={styles.profileHead}>
        <Text numberOfLines={2} style={[styles.profileLabel, { color: selected ? colors.accentInk : colors.textPrimary }]}>{label}</Text>
        {selected ? <View style={[styles.profileCheck, { backgroundColor: colors.accentFill }]}>
          <Check size={11} color={colors.onAccentFill} strokeWidth={3} /></View>
          : count !== undefined ? <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text> : null}
      </View>
      <Text style={[styles.profileExample, { color: colors.textSecondary, backgroundColor: colors.surfaceRaised }]}>{example}</Text>
    </Pressable>
  );
}

/** Сетка плиток: перенос по 3 в ряд. */
export function TileGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31.6%", minHeight: 136, borderRadius: 12, alignItems: "center", paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4, gap: 2 },
  tileIcon: { height: 86, alignItems: "center", justifyContent: "center" },
  tileCompact: { minHeight: 84, paddingTop: 6, paddingBottom: 6 },
  tileIconCompact: { height: 36 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center" },
  count: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  tileCheck: { position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  profileTile: { width: "31.6%", minHeight: 74, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 8, gap: 6, justifyContent: "space-between" },
  profileHead: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  profileLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  profileCheck: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  profileExample: { alignSelf: "flex-start", fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
});
