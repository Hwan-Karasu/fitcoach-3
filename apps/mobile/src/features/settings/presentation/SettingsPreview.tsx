import { PrototypeLink, PrototypeNotice, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";

export function SettingsPreview({
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenClientRosterSettings,
}: Readonly<{ onOpenAppearance: () => void; onOpenNotificationSettings: () => void;
  onOpenClientRosterSettings: () => void }>) {
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
