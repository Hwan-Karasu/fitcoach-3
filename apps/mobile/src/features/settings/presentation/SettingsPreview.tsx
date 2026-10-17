import { PrototypeLink, PrototypeNotice, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";

export function SettingsPreview({
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenClientRosterSettings,
  onOpenQuestionnaireBuilder,
  onOpenExerciseCatalog,
}: Readonly<{ onOpenAppearance: () => void; onOpenNotificationSettings: () => void;
  onOpenClientRosterSettings: () => void; onOpenQuestionnaireBuilder: () => void; onOpenExerciseCatalog: () => void }>) {
  return (
    <PrototypeScreen description="Локальные настройки тренера">
      <PrototypeNotice>
        Это навигационный прототип настроек. Изменения оформления видны сразу, но не сохраняются между запусками.
      </PrototypeNotice>
      <SectionHeading>Внешний вид</SectionHeading>
      <PrototypeLink
        title="Оформление"
        detail="Девять тем и совместимые акценты"
        onPress={onOpenAppearance}
      />
      <SectionHeading>Рабочее пространство</SectionHeading>
      <PrototypeLink title="Список клиентов" detail="Дни рождения и закрепление"
        onPress={onOpenClientRosterSettings} />
      <PrototypeLink title="Конструктор анкеты" detail="Разделы, вопросы, предпросмотр и публикация версий"
        onPress={onOpenQuestionnaireBuilder} />
      <PrototypeLink title="Каталог упражнений" detail="Поиск, фильтры, избранное и свои упражнения"
        onPress={onOpenExerciseCatalog} />
      <PrototypeLink
        title="Уведомления"
        detail="Напоминания, тихие часы и история"
        onPress={onOpenNotificationSettings}
      />
      <PrototypeNotice>
        Резервное копирование, импорт и настройки календаря появятся в своих задачах и не имитируют сохранение сейчас.
      </PrototypeNotice>
    </PrototypeScreen>
  );
}
