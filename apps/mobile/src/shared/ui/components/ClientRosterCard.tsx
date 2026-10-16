import { Pressable, StyleSheet, Text, View } from "react-native";
import { MetricTile, type MetricTileData } from "./MetricTile.tsx";
import { StatusTag, type StatusKind } from "./StatusTag.tsx";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export interface ClientRosterCardData {
  readonly clientId: string;
  readonly displayName: string;
  readonly emoji: string | null;
  readonly badges?: readonly Readonly<{ kind: StatusKind; label: string }>[];
  readonly hasSafetyIndicator?: boolean;
  readonly metrics?: readonly MetricTileData[];
  readonly onOpen: (clientId: string) => void;
  readonly onEditEmoji: (clientId: string) => void;
}

export function ClientRosterCard({
  clientId,
  displayName,
  emoji,
  badges = [],
  hasSafetyIndicator = false,
  metrics = [],
  onOpen,
  onEditEmoji,
}: Readonly<ClientRosterCardData>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const avatar = emoji?.trim() || Array.from(displayName.trim())[0]?.toLocaleUpperCase() || "?";
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Изменить emoji клиента ${displayName}`}
          accessibilityHint="Не открывает карточку клиента"
          onPress={() => onEditEmoji(clientId)}
          style={[styles.avatarButton, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
        >
          <Text style={[styles.avatar, { color: colors.textPrimary }]}>{avatar}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть карточку клиента ${displayName}`}
          onPress={() => onOpen(clientId)}
          style={styles.openButton}
        >
          <Text style={[styles.name, { color: colors.textPrimary }]}>{displayName}</Text>
          <Text style={[styles.openHint, { color: colors.accentInk }]}>Открыть карточку ›</Text>
        </Pressable>
      </View>
      {badges.length || hasSafetyIndicator ? (
        <View style={styles.badges}>
          {badges.map((badge, index) => <StatusTag key={`${badge.kind}:${badge.label}:${index}`} kind={badge.kind} label={badge.label} />)}
          {hasSafetyIndicator ? <StatusTag kind="warning" label="Есть ограничения" /> : null}
        </View>
      ) : null}
      {metrics.length ? (
        <View style={styles.metrics}>
          {metrics.slice(0, 3).map((metric, index) => <MetricTile key={`${metric.label}:${index}`} {...metric} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarButton: { minWidth: 52, minHeight: 52, borderWidth: 1, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatar: { fontSize: 24, lineHeight: 30 },
  openButton: { flex: 1, minHeight: 52, justifyContent: "center", gap: 2 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  openHint: { fontSize: 12, lineHeight: 18 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
