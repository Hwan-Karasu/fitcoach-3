import { useState, type ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow, TOUCH_TARGET } from "../theme/style.ts";
import { emojiFromInput } from "./emojiInput.ts";

/** При четырёх показателях подписи сокращаются, чтобы плашки оставались одной ширины и значение не обрезалось. */
const shortMetricLabels: Readonly<Record<string, string>> = {
  "Следующее занятие": "Занятие", "Последняя тренировка": "Трен.", "Абонемент": "Абон.",
};

/** Показатель карточки: подпись и значение; `value: null` — «нет данных» (§51.2.3), показывается прочерком. */
export interface RosterMetric {
  readonly label: string;
  readonly value: string | null;
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
  /** Метка особой карточки («Через 3 дня · 12 нояб.»): над именем, вместе с ней карточка получает акцентную рамку (UI-OWN-063). */
  readonly highlight?: string | null;
  /** Значок метки особой карточки; получает её цвет. */
  readonly highlightIcon?: (color: string) => ReactNode;
  readonly metrics?: readonly RosterMetric[];
  /** Дополнительная кнопка в строке метки, например «открепить». */
  readonly action?: ReactNode;
  readonly onOpen: (clientId: string) => void;
  /**
   * Быстрая смена эмодзи прямо из списка (§7.8): нажатие на аватар открывает системную клавиатуру,
   * смайл сохраняется сразу, стёртое поле возвращает инициалы (null).
   */
  readonly onChangeEmoji?: (clientId: string, emoji: string | null) => void;
}

/**
 * Карточка клиента (UIX-02, UI-OWN-062/063): отдельная круглая карточка (радиус 26), аватар 52, имя, возраст и бейдж «Ограничения»,
 * ниже ряд плашек показателей одной ширины и высоты: число колонок равно числу показателей (2–4), длинное значение переносится.
 */
export function ClientRosterCard({ clientId, displayName, mark, emoji = null, subtitle, restricted = false, highlight,
  highlightIcon, metrics = [], action, onOpen, onChangeEmoji }: Readonly<ClientRosterCardData>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const spoken = [displayName, subtitle, restricted ? "есть ограничения" : null, highlight]
    .filter((part): part is string => typeof part === "string" && part.length > 0).join(", ");
  const shown = metrics.slice(0, 4);
  const dense = shown.length > 3;
  return (
    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface,
      borderColor: highlight ? colors.accentFill : "transparent" }]}>
      {highlight ? (
        <View style={styles.labelRow}>
          <View style={[styles.highlight, { backgroundColor: colors.accentSoft }]}>
            {highlightIcon?.(colors.onAccentSoft) ?? null}
            <Text numberOfLines={1} style={[styles.highlightText, { color: colors.onAccentSoft }]}>{highlight}</Text>
          </View>
          {action}
        </View>
      ) : null}
      <View style={styles.row}>
        <EmojiAvatar displayName={displayName} mark={mark} emoji={emoji}
          onChange={onChangeEmoji === undefined ? undefined : (value) => onChangeEmoji(clientId, value)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Открыть карточку клиента: ${spoken}`}
          onPress={() => onOpen(clientId)} style={styles.main}>
          <View style={styles.text}>
            <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{displayName}</Text>
            {subtitle || restricted ? (
              <View style={styles.subtitleRow}>
                {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
                {restricted ? (
                  <View style={[styles.badge, { borderColor: colors.warning }]}>
                    <Text style={[styles.badgeText, { color: colors.warning }]}>Ограничения</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>
      {shown.length > 0 ? (
        <View style={styles.plates}>
          {shown.map((metric) => (
            <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value ?? "нет данных"}`}
              style={[styles.plate, { backgroundColor: colors.surfaceRaised }]}>
              <Text numberOfLines={1} style={[styles.plateLabel, { color: colors.textSecondary }]}>
                {dense ? shortMetricLabels[metric.label] ?? metric.label : metric.label}
              </Text>
              <Text style={[styles.plateValue, dense ? styles.plateValueDense : null, { color: metric.value === null ? colors.textMuted : colors.textPrimary }]}>
                {metric.value ?? "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

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
  card: { borderRadius: 26, borderWidth: 2, paddingBottom: 12, overflow: "hidden" },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 14, paddingRight: 6, paddingTop: 10 },
  highlight: { flexShrink: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 },
  highlightText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 10, paddingTop: 10, gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  mark: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  avatarInput: { borderWidth: 2, padding: 0, textAlign: "center", fontSize: 20 },
  main: { flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  subtitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  subtitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  plates: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  plate: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 56, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 8, gap: 2 },
  plateLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  plateValue: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  plateValueDense: { fontSize: 12, lineHeight: 16 },
});
