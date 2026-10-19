import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarCheck, CalendarRange, Layers, ListChecks } from "lucide-react-native";
import type { ReactNode } from "react";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { WEEK_SCOPES, weekScopeLabels, type WeekScope } from "../domain/PeriodizedModel.ts";

/**
 * Контекстное меню области (UI-OWN-041, решение владельца): всплывает после правки недели в конструкторе — когда
 * ввод закончен или выполнено действие со структурой. Нажатие пункта сразу применяет правку к неделям области;
 * закрыть меню = «Только эта неделя». Под пунктом — номера недель, куда попадёт правка.
 */
export function ScopeMenu({ visible, weekIndex, weeksOf, onPick }: Readonly<{
  visible: boolean;
  weekIndex: number;
  /** Номера недель области (для подписи). */
  weeksOf: (scope: WeekScope) => readonly number[];
  onPick: (scope: WeekScope) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const icons: Readonly<Record<WeekScope, ReactNode>> = {
    CURRENT: <CalendarCheck size={18} color={colors.accentInk} strokeWidth={2} />,
    FOLLOWING: <CalendarRange size={18} color={colors.accentInk} strokeWidth={2} />,
    SAME_TYPE: <Layers size={18} color={colors.accentInk} strokeWidth={2} />,
    ALL: <ListChecks size={18} color={colors.accentInk} strokeWidth={2} />,
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onPick("CURRENT")}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={() => onPick("CURRENT")}
          style={[styles.scrim, { backgroundColor: colors.canvas }]} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{`Неделя ${weekIndex} изменена`}</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Применить правку и к другим неделям? Закрыть — только эта неделя.</Text>
          {WEEK_SCOPES.map((scope) => {
            const weeks = weeksOf(scope);
            return (
              <Pressable key={scope} accessibilityRole="button" accessibilityLabel={`${weekScopeLabels[scope]}: недели ${weeks.join(", ")}`}
                onPress={() => onPick(scope)}
                style={({ pressed }) => [styles.option, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
                {icons[scope]}
                <View style={styles.grow}>
                  <Text style={[styles.optionText, { color: colors.textPrimary }]}>{weekScopeLabels[scope]}</Text>
                  <Text numberOfLines={1} style={[styles.hint, { color: colors.textSecondary }]}>{`Недели: ${weeks.join(", ")}`}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", padding: 12 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.7 },
  card: { width: "100%", borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  optionText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  grow: { flex: 1 },
});
