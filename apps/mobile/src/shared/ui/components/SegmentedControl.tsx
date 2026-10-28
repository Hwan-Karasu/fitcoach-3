import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

interface SegmentItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Длительность и кривая скольжения выбранного сегмента — как у панели таймеров отдыха. */
const SLIDE_MS = 200;
const EASE = Easing.out(Easing.cubic);

/** Переключатель из 2–3 равных сегментов во всю ширину (UI-OWN-026); «Зефирка»: дорожка, выбранный — белый с тенью. */
export function SegmentedControl<Id extends string>({ items, selectedId, onSelect, compact = false, fit = false, scroll = false, wrap = false, slide = false, scrollItemGap = 2 }: Readonly<{
  items: readonly SegmentItem<Id>[];
  selectedId: Id;
  onSelect: (id: Id) => void;
  /** Четыре и более пункта: ниже, мельче шрифт, подпись ужимается, а не обрезается. */
  compact?: boolean;
  /** Подписи разной длины: ширина сегмента — по тексту, свободное место делится поровну; шрифт ужимается, а не обрезается. */
  fit?: boolean;
  /** Много пунктов: один контейнер с горизонтальной прокруткой, сегменты по ширине подписи. */
  scroll?: boolean;
  /** С `scroll`: длинные подписи (названия циклов) переносятся на вторую строку и сжимаются, ширина вкладки ограничена. */
  wrap?: boolean;
  /** С `scroll`: выбранный сегмент плавно скользит (индикатор на UI-потоке) и прокручивается в видимую область. */
  slide?: boolean;
  /** Отступ между пунктами горизонтального меню. */
  scrollItemGap?: number;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const sliding = scroll && slide;
  const layouts = useRef(new Map<string, Readonly<{ x: number; width: number }>>());
  const viewportWidth = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const placed = useRef(false);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  const indicatorStyle = useAnimatedStyle(() => ({ opacity: indicatorOpacity.value, width: indicatorWidth.value, transform: [{ translateX: indicatorX.value }] }));
  // Первое размещение — без анимации; дальше индикатор скользит к выбранному, а вкладка встаёт в центр видимой области.
  const moveTo = (id: string) => {
    const at = layouts.current.get(id);
    if (at === undefined) return;
    const animated = placed.current;
    if (animated) {
      indicatorX.value = withTiming(at.x, { duration: SLIDE_MS, easing: EASE });
      indicatorWidth.value = withTiming(at.width, { duration: SLIDE_MS, easing: EASE });
    } else {
      indicatorX.value = at.x; indicatorWidth.value = at.width; indicatorOpacity.value = 1; placed.current = true;
    }
    scrollRef.current?.scrollTo({ x: Math.max(0, at.x - (viewportWidth.current - at.width) / 2), animated });
  };
  useEffect(() => { if (sliding) moveTo(selectedId); }, [selectedId, sliding]);
  const segments = items.map((item) => {
    const selected = item.id === selectedId;
    return (
      <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
        onPress={() => onSelect(item.id)}
        onLayout={sliding ? (event) => {
          const { x, width } = event.nativeEvent.layout;
          layouts.current.set(item.id, { x, width });
          if (item.id === selectedId) moveTo(item.id);
        } : undefined}
        style={[styles.segment, fit ? styles.segmentFit : null, scroll ? styles.segmentScroll : null, scroll && wrap ? styles.segmentWrap : null, compact ? styles.segmentCompact : null, selected && !sliding ? [shadow.control, { backgroundColor: colors.surface }] : null]}>
        <Text numberOfLines={scroll && wrap ? 2 : 1} adjustsFontSizeToFit={((compact || fit) && !scroll) || (scroll && wrap)} minimumFontScale={scroll && wrap ? 0.75 : 0.85} style={[styles.label, compact ? styles.labelCompact : null, scroll && wrap ? styles.labelWrap : null, selected ? styles.selected : null, { color: selected ? colors.accentInk : colors.textSecondary }]}>{item.label}</Text>
      </Pressable>
    );
  });
  return (
    <View accessibilityRole="tablist" style={[styles.track, compact ? styles.trackCompact : null, scroll ? styles.trackScroll : null, scroll && wrap ? styles.trackWrap : null, { backgroundColor: colors.border }]}>
      {scroll ? <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scrollContent, { gap: scrollItemGap }]}
        onLayout={sliding ? (event) => { viewportWidth.current = event.nativeEvent.layout.width; moveTo(selectedId); } : undefined}>
        {sliding ? <Animated.View pointerEvents="none" style={[styles.indicator, shadow.control, { backgroundColor: colors.surface }, indicatorStyle]} /> : null}
        {segments}
      </ScrollView> : segments}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", height: 48, borderRadius: 16, padding: 4, gap: 4 },
  segment: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentFit: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", paddingHorizontal: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  selected: { fontFamily: fonts.bold },
  segmentScroll: { flex: 0, paddingHorizontal: 8 },
  scrollContent: { gap: 2 },
  indicator: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 12 },
  trackScroll: { height: 40 },
  trackWrap: { height: "auto", minHeight: 40 },
  segmentWrap: { minWidth: 72, maxWidth: 176, paddingVertical: 3 },
  trackCompact: { height: 44, borderRadius: 14, padding: 3, gap: 2 },
  segmentCompact: { borderRadius: 11, paddingHorizontal: 2 },
  labelWrap: { fontSize: 13, lineHeight: 16, textAlign: "center" },
  labelCompact: { fontSize: 13, lineHeight: 17 },
});
