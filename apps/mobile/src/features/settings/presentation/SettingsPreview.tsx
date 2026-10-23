import { PrototypeLink, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";

export function SettingsPreview({
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenClientRosterSettings,
  onOpenQuestionnaireBuilder,
  onOpenExerciseCatalog,
  onOpenTrainingSettings,
  onOpenBackup,
}: Readonly<{ onOpenAppearance: () => void; onOpenNotificationSettings: () => void;
  onOpenClientRosterSettings: () => void; onOpenQuestionnaireBuilder: () => void; onOpenExerciseCatalog: () => void;
  onOpenTrainingSettings: () => void; onOpenBackup: () => void }>) {
  return (
    <PrototypeScreen description="Локальные настройки тренера">
      <SectionHeading>Внешний вид</SectionHeading>
      <PrototypeLink
        title="Оформление"
        detail="Девять тем и акценты — выбор сохраняется"
        onPress={onOpenAppearance}
      />
      <SectionHeading>Рабочее пространство</SectionHeading>
      <PrototypeLink title="Список клиентов" detail="Дни рождения и закрепление"
        onPress={onOpenClientRosterSettings} />
      <PrototypeLink title="Конструктор анкеты" detail="Разделы, вопросы, предпросмотр и публикация версий"
        onPress={onOpenQuestionnaireBuilder} />
      <PrototypeLink title="Каталог упражнений" detail="Поиск, фильтры, избранное и свои упражнения"
        onPress={onOpenExerciseCatalog} />
      <PrototypeLink title="Тренировки" detail="Как засчитывать подход: автоматически или галочкой"
        onPress={onOpenTrainingSettings} />
      <PrototypeLink
        title="Уведомления"
        detail="Напоминания, тихие часы и история"
        onPress={onOpenNotificationSettings}
      />
      <SectionHeading>Данные</SectionHeading>
      <PrototypeLink title="Резервные копии" detail="Создание копии и экспорт в другую папку" onPress={onOpenBackup} />
    </PrototypeScreen>
  );
}
