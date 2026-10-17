import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/** Ячейка метрики карточки; `value: null` — «нет данных», а не ноль (§51.2.3). */
export interface RosterMetric {
  readonly label: string;
  readonly value: string | null;
}

export interface ClientRosterCardData {
  readonly clientId: string;
  readonly displayName: string;
  /** Эмодзи или инициалы для аватара. */
  readonly mark: string;
  /** Строка под именем, например «34 года». */
  readonly subtitle?: string | null;
  /** Нейтральный индикатор ограничений без раскрытия диагнозов (§7). */
  readonly restricted?: boolean;
  /** Бейдж особой карточки («ДР через 3 д.»); вместе с ним появляется акцентная полоса (UI-OWN-013). */
  readonly highlight?: string | null;
  readonly metrics?: readonly RosterMetric[];
  /** Дополнительная кнопка справа, например «убрать из закреплённых». */
  readonly action?: ReactNode;
  readonly onOpen: (clientId: string) => void;
  readonly onEditEmoji?: (clientId: string) => void;
}

/** Карточка клиента (CLIENTS.md): рамка 1px без тени, аватар-квадрат 44, «›», без кнопки «Изменить». */
export function ClientRosterCard({ clientId, displayName, mark, subtitle, restricted = false, highlight,
  metrics = [], action, onOpen, onEditEmoji }: Readonly<ClientRosterCardData>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const spoken = [displayName, subtitle, restricted ? "есть ограничения" : null, highlight]
    .filter((part): part is string => typeof part === "string" && part.length > 0).join(", ");
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {highlight ? <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} /> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Сменить эмодзи клиента ${displayName}`}
          accessibilityHint="Не открывает карточку клиента"
          disabled={onEditEmoji === undefined}
          onPress={() => onEditEmoji?.(clientId)}
          hitSlop={2}
          style={[styles.avatar, { backgroundColor: colors.surfaceRaised }]}
        >
          <Text style={[styles.mark, { color: colors.textPrimary }]}>{mark}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Открыть карточку клиента: ${spoken}`}
          onPress={() => onOpen(clientId)} style={styles.main}>
          <View style={styles.text}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.textPrimary }]}>{displayName}</Text>
            {subtitle || restricted ? (
              <View style={styles.subtitleRow}>
                {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
                {restricted ? (
                  <View style={[styles.badge, { borderColor: colors.warning }]}>
                    <Text style={[styles.badgeText, { color: colors.warning }]}>Есть ограничения</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {highlight ? (
            <View style={[styles.highlight, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.highlightText, { color: colors.accentInk }]}>{highlight}</Text>
            </View>
          ) : null}
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
        {action}
      </View>
      {metrics.length > 0 ? (
        <View style={[styles.metrics, { borderTopColor: colors.border }]}>
          {metrics.slice(0, 3).map((metric) => (
            <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value ?? "нет данных"}`}
              style={styles.metric}>
              <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>{metric.label}</Text>
              <Text numberOfLines={1} style={[styles.metricValue, { color: metric.value === null ? colors.textMuted : colors.textPrimary }]}>
                {metric.value ?? "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 8, paddingVertical: 10, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  mark: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  main: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  subtitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
  highlight: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  highlightText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  metrics: { flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  metric: { flex: 1, gap: 2 },
  metricLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  metricValue: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
});
