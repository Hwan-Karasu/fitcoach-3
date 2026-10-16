import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

interface SectionTabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

interface SectionTabsProps<Id extends string> {
  readonly tabs: readonly SectionTabItem<Id>[];
  readonly selectedId: Id;
  readonly onSelect: (id: Id) => void;
}

export function SectionTabs<Id extends string>({ tabs, selectedId, onSelect }: Readonly<SectionTabsProps<Id>>) {
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<Id, number>());
  const [focusedId, setFocusedId] = useState<Id | null>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  useEffect(() => {
    const x = offsets.current.get(selectedId);
    if (x !== undefined) scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [selectedId]);
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={`Перейти к разделу ${tab.label}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(tab.id)}
            onFocus={() => setFocusedId(tab.id)}
            onBlur={() => setFocusedId((current) => current === tab.id ? null : current)}
            onLayout={(event) => {
              const x = event.nativeEvent.layout.x;
              offsets.current.set(tab.id, x);
              if (selected) scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: false });
            }}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: selected ? colors.accentFill : colors.surface,
                borderColor: focusedId === tab.id ? colors.focusRing : selected ? colors.accentFill : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.label, { color: selected ? colors.onAccentFill : colors.textPrimary }]}>
              {selected ? `✓ ${tab.label}` : tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 2, borderRadius: 24, justifyContent: "center" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
});
