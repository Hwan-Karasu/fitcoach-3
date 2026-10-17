import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { emojiFromInput } from "./emojiInput.ts";

/**
 * Смена эмодзи клиента (§7.8): системная клавиатура, любой смайл; первый введённый эмодзи сразу
 * сохраняется. Окно вверху экрана, чтобы клавиатура его не закрывала.
 */
export function EmojiPicker({ visible, initials, selected, onSelect, onClose }: Readonly<{
  visible: boolean;
  /** Как выглядят инициалы клиента — для кнопки «вернуть инициалы». */
  initials: string;
  selected: string | null;
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { progress.setValue(0); return; }
    setDraft("");
    setHint(null);
    Animated.timing(progress, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, visible]);

  const pick = (value: string | null) => { onSelect(value); onClose(); };
  const change = (text: string) => {
    setDraft(text);
    const emoji = emojiFromInput(text);
    if (emoji !== null) { pick(emoji); return; }
    setHint(text.trim() === "" ? null : "Только эмодзи — откройте смайлы на клавиатуре.");
  };
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть выбор эмодзи" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <Animated.View accessibilityLabel="Выбор эмодзи" style={[styles.panel, {
        top: insets.top + 64, backgroundColor: colors.surface, borderColor: colors.border, opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Эмодзи клиента</Text>
        <View style={styles.row}>
          <TextInput autoFocus value={draft} onChangeText={change} placeholder={selected ?? "🙂"}
            placeholderTextColor={colors.textMuted} selectionColor={colors.accentInk} caretHidden
            accessibilityLabel="Эмодзи с клавиатуры" accessibilityHint="Откройте смайлы на клавиатуре и выберите один"
            style={[styles.input, { borderColor: colors.focusRing, backgroundColor: colors.input, color: colors.textPrimary }]} />
          <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === null }}
            accessibilityLabel="Вернуть инициалы" onPress={() => pick(null)}
            style={({ pressed }) => [styles.initials, {
              borderColor: selected === null ? colors.accentInk : colors.border,
              backgroundColor: pressed ? colors.surfaceRaised : "transparent",
            }]}>
            <View style={[styles.initialsMark, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.initialsText, { color: colors.textPrimary }]}>{initials}</Text>
            </View>
            <Text style={[styles.initialsLabel, { color: colors.textPrimary }]}>Инициалы</Text>
          </Pressable>
        </View>
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: hint === null ? colors.textSecondary : colors.danger }]}>
          {hint ?? "Выберите любой смайл на клавиатуре — он сохранится сразу."}
        </Text>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.3)" },
  panel: {
    position: "absolute", left: 16, right: 16, borderWidth: 1, borderRadius: 12, padding: 12, gap: 10,
    elevation: 6, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { width: 64, height: 56, borderWidth: 2, borderRadius: 8, textAlign: "center", fontSize: 30, paddingVertical: 0 },
  initials: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  initialsMark: { width: 32, height: 32, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  initialsText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  initialsLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
