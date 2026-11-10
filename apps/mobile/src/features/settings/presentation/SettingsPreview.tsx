import type { ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Bell, ChevronRight, ClipboardList, DatabaseBackup, Dumbbell, Palette, SlidersHorizontal, Users, type LucideProps } from "lucide-react-native";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { CLIENT_START_SECTIONS } from "../../../shared/domain/ClientCardPreference.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";

/** Пункт настроек: иконка в круге, название и подпись (живая — если есть, иначе описание); у последнего в блоке разделителя нет. */
function Row({ icon: Icon, title, caption, fallback, last = false, onPress }: Readonly<{
  icon: ComponentType<LucideProps>; title: string; caption: string | null | undefined; fallback: string; last?: boolean; onPress: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const detail = caption ?? fallback;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail} onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceRaised : "transparent",
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Icon size={20} color={colors.accentInk} /></View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.caption, { color: caption === null || caption === undefined ? colors.textMuted : colors.textSecondary }]}>{detail}</Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} style={styles.chevron} />
    </Pressable>
  );
}

function Group({ children }: Readonly<{ children: React.ReactNode }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <View style={[styles.group, shadow.card, { backgroundColor: colors.surface }]}>{children}</View>;
}

/**
 * «Настройки»: группы «Внешний вид / Рабочее пространство / Данные» круглыми блоками; у пункта иконка и живая подпись (UIX-13, UI-OWN-082).
 * Состав и порядок пунктов прежние. Подписи, которых экран не знает (анкета и т. п.), приходят снаружи; `null` — данных пока нет.
 */
export function SettingsPreview({
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenClientRosterSettings,
  onOpenQuestionnaireBuilder,
  onOpenExerciseCatalog,
  onOpenTrainingSettings,
  onOpenBackup,
  questionnaireCaption,
}: Readonly<{ onOpenAppearance: () => void; onOpenNotificationSettings: () => void;
  onOpenClientRosterSettings: () => void; onOpenQuestionnaireBuilder: () => void; onOpenExerciseCatalog: () => void;
  onOpenTrainingSettings: () => void; onOpenBackup: () => void;
  /** «Версия 3 · 5 разделов» — текущая опубликованная анкета. */
  questionnaireCaption?: string | null }>) {
  const { palette, clientCards } = usePrototypeTheme();
  const startLabel = CLIENT_START_SECTIONS.find((section) => section.id === clientCards.startSection)?.label ?? "";
  return (
    <PrototypeScreen>
      <SectionHeading>Внешний вид</SectionHeading>
      <Group>
        <Row icon={Palette} title="Оформление" caption={`Тема «${palette.themeName}» · ${palette.accentName}`} fallback="Темы и акценты — выбор сохраняется" last onPress={onOpenAppearance} />
      </Group>
      <SectionHeading>Рабочее пространство</SectionHeading>
      <Group>
        <Row icon={Users} title="Список и карточки клиентов" caption={`Начало: ${startLabel} · плиток ${clientCards.metricIds.length} из 4`} fallback="Начальный раздел, плитки и дни рождения" onPress={onOpenClientRosterSettings} />
        <Row icon={ClipboardList} title="Конструктор анкеты" caption={questionnaireCaption} fallback="Разделы, вопросы, предпросмотр и публикация версий" onPress={onOpenQuestionnaireBuilder} />
        <Row icon={Dumbbell} title="Каталог упражнений" caption={null} fallback="Поиск, фильтры, избранное и свои упражнения" onPress={onOpenExerciseCatalog} />
        <Row icon={SlidersHorizontal} title="Тренировки" caption={null} fallback="Как засчитывать подход: автоматически или галочкой" onPress={onOpenTrainingSettings} />
        <Row icon={Bell} title="Уведомления" caption={null} fallback="Напоминания, тихие часы и история" last onPress={onOpenNotificationSettings} />
      </Group>
      <SectionHeading>Данные</SectionHeading>
      <Group>
        <Row icon={DatabaseBackup} title="Резервные копии" caption={null} fallback="Создание копии и экспорт в другую папку" last onPress={onOpenBackup} />
      </Group>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: 26, overflow: "hidden" },
  row: { minHeight: 68, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  icon: { width: 40, height: 40, flexShrink: 0, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  chevron: { flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
