import { Bell, ClipboardList, DatabaseBackup, Palette, SlidersHorizontal, Users } from "lucide-react-native";
import { SettingsGroup, SettingsRow } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { CLIENT_START_SECTIONS } from "../../../shared/domain/ClientCardPreference.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";

/**
 * «Настройки»: группы «Внешний вид / Рабочее пространство / Данные» круглыми блоками; у пункта иконка и живая подпись (UIX-13, UI-OWN-082).
 * Состав и порядок пунктов прежние. Подписи, которых экран не знает (анкета и т. п.), приходят снаружи; `null` — данных пока нет.
 */
export function SettingsPreview({
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenClientRosterSettings,
  onOpenQuestionnaireBuilder,
  onOpenTrainingSettings,
  onOpenBackup,
  questionnaireCaption,
}: Readonly<{ onOpenAppearance: () => void; onOpenNotificationSettings: () => void;
  onOpenClientRosterSettings: () => void; onOpenQuestionnaireBuilder: () => void;
  onOpenTrainingSettings: () => void; onOpenBackup: () => void;
  /** «Версия 3 · 5 разделов» — текущая опубликованная анкета. */
  questionnaireCaption?: string | null }>) {
  const { palette, clientCards } = usePrototypeTheme();
  const startLabel = CLIENT_START_SECTIONS.find((section) => section.id === clientCards.startSection)?.label ?? "";
  const questionnaire = questionnaireCaption ?? null;
  return (
    <PrototypeScreen>
      <SectionHeading>Внешний вид</SectionHeading>
      <SettingsGroup>
        <SettingsRow icon={Palette} title="Оформление" caption={`Тема «${palette.themeName}» · ${palette.accentName}`} last onPress={onOpenAppearance} />
      </SettingsGroup>
      <SectionHeading>Рабочее пространство</SectionHeading>
      <SettingsGroup>
        <SettingsRow icon={Users} title="Список и карточки клиентов" caption={`Начало: ${startLabel} · плиток ${clientCards.metricIds.length} из 4`} onPress={onOpenClientRosterSettings} />
        <SettingsRow icon={ClipboardList} title="Конструктор анкеты" caption={questionnaire ?? "Разделы, вопросы, предпросмотр и публикация версий"} captionMuted={questionnaire === null} onPress={onOpenQuestionnaireBuilder} />
        <SettingsRow icon={SlidersHorizontal} title="Тренировки" caption="Как засчитывать подход: автоматически или галочкой" captionMuted onPress={onOpenTrainingSettings} />
        <SettingsRow icon={Bell} title="Уведомления" caption="Напоминания, тихие часы и история" captionMuted last onPress={onOpenNotificationSettings} />
      </SettingsGroup>
      <SectionHeading>Данные</SectionHeading>
      <SettingsGroup>
        <SettingsRow icon={DatabaseBackup} title="Резервные копии" caption="Создание копии и экспорт в другую папку" captionMuted last onPress={onOpenBackup} />
      </SettingsGroup>
    </PrototypeScreen>
  );
}
