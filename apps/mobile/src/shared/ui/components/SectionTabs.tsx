import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

interface SectionTabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** Значок слева от подписи (lucide). */
  readonly icon?: LucideIcon;
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
            hitSlop={{ top: 6, bottom: 6 }}
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
              selected ? null : shadow.chip,
              {
                backgroundColor: selected ? colors.accentFill : colors.surface,
                borderColor: focusedId === tab.id ? colors.focusRing : selected ? colors.accentFill : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {tab.icon === undefined ? null : <tab.icon size={15} color={selected ? colors.onAccentFill : colors.textSecondary} />}
            <Text style={[styles.label, { color: selected ? colors.onAccentFill : colors.textPrimary }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  content: { paddingHorizontal: 16, paddingVertical: 6, gap: 6 },
  // Видимая высота 36; область нажатия 48 (hitSlop) — требование проекта к целям нажатия.
  tab: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1.5, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  label: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, textAlign: "center" },
});
