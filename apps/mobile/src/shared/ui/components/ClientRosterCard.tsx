import { Children, Fragment, useState, type ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow, TOUCH_TARGET } from "../theme/style.ts";
import { emojiFromInput } from "./emojiInput.ts";

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
  /** Текущий эмодзи клиента; null — показываются инициалы. */
  readonly emoji?: string | null;
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
  /**
   * Быстрая смена эмодзи прямо из списка (§7.8): нажатие на аватар открывает системную клавиатуру,
   * смайл сохраняется сразу, стёртое поле возвращает инициалы (null).
   */
  readonly onChangeEmoji?: (clientId: string, emoji: string | null) => void;
  /** «Зефирка» (UI-OWN-048): строка внутри общей карточки `RosterGroup` — без своего фона. */
  readonly inGroup?: boolean;
  /** Показатели плитками с подписями (закреплённая карточка «Недавно открывали» / «Дни рождения»). */
  readonly metricTiles?: boolean;
}

/**
 * Карточка клиента (CLIENTS.md; «Зефирка», UI-OWN-048): белая, радиус 20, тень без рамки, аватар 44 (радиус 14) на мягком
 * фоне акцента, «›». В общей карточке `RosterGroup` — строка с разделителем.
 */
export function ClientRosterCard({ clientId, displayName, mark, emoji = null, subtitle, restricted = false, highlight,
  highlightIcon, metrics = [], action, onOpen, onChangeEmoji, inGroup = false, metricTiles = false }: Readonly<ClientRosterCardData>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const spoken = [displayName, subtitle, restricted ? "есть ограничения" : null, highlight]
    .filter((part): part is string => typeof part === "string" && part.length > 0).join(", ");
  return (
    <View style={inGroup ? styles.groupRow : [styles.card, shadow.card, { backgroundColor: colors.surface }]}>
      {highlight ? <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} /> : null}
      <View style={styles.row}>
        <EmojiAvatar displayName={displayName} mark={mark} emoji={emoji}
          onChange={onChangeEmoji === undefined ? undefined : (value) => onChangeEmoji(clientId, value)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Открыть карточку клиента: ${spoken}`}
          onPress={() => onOpen(clientId)} style={styles.main}>
          <View style={styles.text}>
            <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{displayName}</Text>
            {subtitle || restricted || highlight ? (
              <View style={styles.subtitleRow}>
                {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
                {highlight ? (
                  <View style={[styles.highlight, { backgroundColor: colors.surfaceRaised }]}>
                    {highlightIcon?.(colors.warning) ?? null}
                    <Text style={[styles.highlightText, { color: colors.warning }]}>{highlight}</Text>
                  </View>
                ) : null}
                {restricted ? (
                  <View style={[styles.badge, { borderColor: colors.warning }]}>
                    <Text style={[styles.badgeText, { color: colors.warning }]}>Есть ограничения</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {/* Дополнительное действие («открепить») — перед стрелкой, стрелка всегда у края. */}
          {action}
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>
      {metrics.length > 0 && metricTiles ? (
        <View style={styles.tiles}>
          {metrics.slice(0, 3).map((metric) => (
            <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value ?? "нет данных"}`}
              style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
              <Text numberOfLines={2} style={[styles.tileLabel, { color: colors.textSecondary }]}>{metric.label}</Text>
              <Text numberOfLines={1} style={[styles.tileValue, { color: metric.value === null ? colors.textMuted : colors.textPrimary }]}>
                {metric.value ?? "—"}</Text>
            </View>
          ))}
        </View>
      ) : metrics.length > 0 ? (
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

/** Общая белая карточка списка клиентов («Зефирка»): строки `ClientRosterCard inGroup` с разделителями. */
export function RosterGroup({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;
  return (
    <View style={[styles.group, shadow.card, { backgroundColor: colors.surface }]}>
      {rows.map((row, index) => <Fragment key={index}>
        {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
        {row}
      </Fragment>)}
    </View>
  );
}

/** Доли ширины показателей: следующее занятие длиннее («Сегодня 18:00»), тренировка — короткая дата. */
const metricWeights = [1.5, 0.8, 1.2];

/** Аватар; в режиме правки — то же поле ввода, куда системная клавиатура вставляет смайл. */
function EmojiAvatar({ displayName, mark, emoji, onChange }: Readonly<{
  displayName: string; mark: string; emoji: string | null; onChange?: (emoji: string | null) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [editing, setEditing] = useState(false);
  const finish = (value: string | null | undefined) => {
    setEditing(false);
    Keyboard.dismiss();
    if (value !== undefined && value !== emoji) onChange?.(value);
  };
  if (editing) {
    return (
      <TextInput autoFocus caretHidden selectTextOnFocus defaultValue={emoji ?? ""} placeholder={mark}
        placeholderTextColor={colors.textMuted} selectionColor="transparent"
        accessibilityLabel={`Эмодзи клиента ${displayName}`} accessibilityHint="Выберите смайл на клавиатуре; стереть — вернуть инициалы"
        onBlur={() => setEditing(false)}
        onChangeText={(text) => {
          if (text.trim() === "") { finish(null); return; }
          // Новый смайл мог встать рядом со старым, если выделение не сработало.
          const added = emoji !== null && text.startsWith(emoji) ? text.slice(emoji.length) : text;
          const value = emojiFromInput(added) ?? emojiFromInput(text);
          if (value !== null) finish(value);
        }}
        style={[styles.avatar, styles.avatarInput, { backgroundColor: colors.surfaceRaised, borderColor: colors.focusRing,
          color: colors.textPrimary }]} />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Сменить эмодзи клиента ${displayName}`}
      accessibilityHint="Открывает клавиатуру, не открывает карточку клиента"
      disabled={onChange === undefined}
      onPress={() => setEditing(true)}
      hitSlop={2}
      style={[styles.avatar, { backgroundColor: colors.accentSoft }]}
    >
      <Text style={[styles.mark, { color: colors.accentInk }]}>{mark}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, overflow: "hidden" },
  groupRow: { overflow: "hidden" },
  group: { borderRadius: 20, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 10, paddingVertical: 12, gap: 12 },
  avatar: { width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  mark: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  avatarInput: { borderWidth: 2, padding: 0, textAlign: "center", fontSize: 18 },
  main: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  subtitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  subtitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  highlight: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 },
  highlightText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  metrics: { flexDirection: "row", paddingLeft: 72, paddingRight: 16, paddingBottom: 12, marginTop: -6, gap: 12 },
  metric: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  metricValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  tiles: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 14 },
  tile: { flex: 1, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, gap: 1 },
  tileLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
});
