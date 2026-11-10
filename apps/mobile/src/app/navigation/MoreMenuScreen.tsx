import type { ComponentType } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChartColumn, ChevronRight, ClipboardList, History, type LucideProps } from "lucide-react-native";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { shadow } from "../../shared/ui/theme/style.ts";
import { moreDestinations } from "./routeCatalog.ts";

/** Карточка раздела «Ещё»: иконка в круге, название и живая подпись (UIX-10, UI-OWN-076); подпись `null` — пока данных нет, показывается описание. */
function MoreCard({ icon: Icon, title, caption, fallback, onPress }: Readonly<{
  icon: ComponentType<LucideProps>; title: string; caption: string | null; fallback: string; onPress: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const detail = caption ?? fallback;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} onPress={onPress}
      style={({ pressed }) => [styles.card, shadow.card, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
        <Icon size={22} color={colors.accentInk} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text numberOfLines={2} style={[styles.caption, { color: caption === null ? colors.textMuted : colors.textSecondary }]}>{detail}</Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * «Ещё» клиента: «Анкета», «История занятий», «Статистика» — карточки с иконкой и живой подписью. Подписи считают владельцы данных
 * (анкета — заполненность, история — завершённые занятия, статистика — итог месяца); `null` — данных ещё нет.
 */
export function MoreMenuScreen({
  onOpenQuestionnaire,
  onOpenArchive,
  onOpenStatistics,
  questionnaireCaption = null,
  historyCaption = null,
  statisticsCaption = null,
}: Readonly<{
  onOpenQuestionnaire: () => void;
  onOpenArchive: () => void;
  onOpenStatistics: () => void;
  questionnaireCaption?: string | null;
  historyCaption?: string | null;
  statisticsCaption?: string | null;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      <MoreCard icon={ClipboardList} title={moreDestinations.Questionnaire} caption={questionnaireCaption} fallback="Сведения клиента" onPress={onOpenQuestionnaire} />
      <MoreCard icon={History} title={moreDestinations.TrainingArchive} caption={historyCaption} fallback="Все проведённые тренировки" onPress={onOpenArchive} />
      <MoreCard icon={ChartColumn} title={moreDestinations.Statistics} caption={statisticsCaption} fallback="Общая статистика клиента" onPress={onOpenStatistics} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { minHeight: 76, borderRadius: 26, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
