import { useEffect, useRef, useState, type RefObject } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Check } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface DropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

type Frame = Readonly<{ x: number; y: number; width: number; height: number }>;

const MIN_WIDTH = 200;
const EDGE = 16;

/** Выпадающий список под кнопкой-якорем: один выбор, закрытие нажатием мимо или «Назад». */
export function DropdownMenu<T extends string>({ visible, anchor, title, note, options, selected, onSelect, onClose }: Readonly<{
  visible: boolean;
  anchor: RefObject<View | null>;
  /** Озвучивается TalkBack как название списка. */
  title: string;
  /** Пояснение под вариантами, например почему вариантов пока мало. */
  note?: string;
  options: readonly DropdownOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { width: screenWidth } = useWindowDimensions();
  const [frame, setFrame] = useState<Frame | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { setFrame(null); progress.setValue(0); return; }
    anchor.current?.measureInWindow((x, y, width, height) => setFrame({ x, y, width, height }));
  }, [anchor, progress, visible]);

  useEffect(() => {
    if (frame === null) return;
    Animated.timing(progress, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [frame, progress]);

  const menuWidth = frame === null ? MIN_WIDTH : Math.max(frame.width, MIN_WIDTH);
  const left = frame === null ? EDGE : Math.max(EDGE, Math.min(frame.x, screenWidth - EDGE - menuWidth));
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть список" style={StyleSheet.absoluteFill} onPress={onClose} />
      {frame === null ? null : (
        <Animated.View accessibilityLabel={title} style={[styles.menu, {
          top: frame.y + frame.height + 4, left, width: menuWidth,
          backgroundColor: colors.surface, borderColor: colors.border, opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
        }]}>
          {options.map((option) => {
            const active = option.value === selected;
            return (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }}
                accessibilityLabel={option.label}
                onPress={() => { onSelect(option.value); onClose(); }}
                style={({ pressed }) => [styles.option, pressed ? { backgroundColor: colors.surfaceRaised } : null]}>
                <Text style={[styles.label, { color: active ? colors.accentInk : colors.textPrimary }]}>{option.label}</Text>
                {active ? <Check size={18} color={colors.accentInk} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
          {note ? (
            <View style={[styles.noteBox, { borderTopColor: colors.border }]}>
              <Text style={[styles.note, { color: colors.textSecondary }]}>{note}</Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute", borderWidth: 1, borderRadius: 8, paddingVertical: 4,
    elevation: 6, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  option: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  noteBox: { borderTopWidth: 1, marginTop: 4, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
