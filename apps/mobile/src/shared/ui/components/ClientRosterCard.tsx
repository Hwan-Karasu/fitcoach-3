import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/** Метрика карточки: значок и значение; `label` читает TalkBack. `value: null` — «нет данных» (§51.2.3). */
export interface RosterMetric {
  readonly label: string;
  readonly value: string | null;
  readonly icon: (color: string) => ReactNode;
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
  /** Значок бейджа особой карточки; получает его цвет. */
  readonly highlightIcon?: (color: string) => ReactNode;
  readonly metrics?: readonly RosterMetric[];
  /** Дополнительная кнопка справа, например «убрать из закреплённых». */
  readonly action?: ReactNode;
  readonly onOpen: (clientId: string) => void;
  readonly onEditEmoji?: (clientId: string) => void;
}

/** Карточка клиента (CLIENTS.md): рамка 1px без тени, аватар-квадрат 44 (радиус 8), «›», без кнопки «Изменить». */
export function ClientRosterCard({ clientId, displayName, mark, subtitle, restricted = false, highlight,
  highlightIcon, metrics = [], action, onOpen, onEditEmoji }: Readonly<ClientRosterCardData>) {
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
              {highlightIcon?.(colors.warning) ?? null}
              <Text style={[styles.highlightText, { color: colors.warning }]}>{highlight}</Text>
            </View>
          ) : null}
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
        {action}
      </View>
      {metrics.length > 0 ? (
        <View style={styles.metrics}>
          {metrics.slice(0, 3).map((metric, index) => (
            <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value ?? "нет данных"}`}
              style={[styles.metric, { flex: metricWeights[index] ?? 1 }]}>
              {metric.icon(colors.textSecondary)}
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

/** Доли ширины показателей: следующее занятие длиннее («Сегодня 18:00»), тренировка — короткая дата. */
const metricWeights = [1.5, 0.8, 1.2];

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 8, paddingVertical: 10, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  mark: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  main: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  subtitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
  highlight: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 },
  highlightText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  metrics: { flexDirection: "row", paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  metric: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  metricValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
