import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface SheetOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** Нижний лист с одним выбором: сортировка и другие списки вариантов у пилюль. */
export function OptionSheet<T extends string>({ visible, title, options, selected, onSelect, onClose }: Readonly<{
  visible: boolean;
  title: string;
  options: readonly SheetOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: 12 + insets.bottom }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }}
              accessibilityLabel={option.label}
              onPress={() => { onSelect(option.value); onClose(); }}
              style={({ pressed }) => [styles.option, pressed ? { backgroundColor: colors.surfaceRaised } : null]}>
              <Text style={[styles.optionLabel, { color: active ? colors.accentInk : colors.textPrimary }]}>{option.label}</Text>
              {active ? <Check size={20} color={colors.accentInk} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingHorizontal: 8 },
  title: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 4 },
  option: { minHeight: 48, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
});
