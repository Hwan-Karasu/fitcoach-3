import { EmptyPanel, PrototypeLink, PrototypeNotice, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";

export function NotificationsPreview({ onOpenSettings }: Readonly<{ onOpenSettings: () => void }>) {
  return (
    <PrototypeScreen description="Локальные события и напоминания тренера">
      <PrototypeNotice>
        Прототип центра уведомлений. События, отметки прочтения и Android-доставка пока не подключены; фиктивных непрочитанных записей нет.
      </PrototypeNotice>
      <SectionHeading>История</SectionHeading>
      <EmptyPanel
        title="История пока не подключена"
        body="Здесь будут только локальные события после реализации их хранения и правил прочтения."
      />
      <PrototypeLink
        title="Настройки уведомлений"
        detail="Напоминания, тихие часы и срок хранения"
        onPress={onOpenSettings}
      />
    </PrototypeScreen>
  );
}

export function NotificationSettingsPreview() {
  return (
    <PrototypeScreen description="Единые настройки для центра и системного меню">
      <PrototypeNotice>
        Настройки пока не сохраняются. Переключатели появятся вместе с локальным Settings repository и проверкой Android-разрешений.
      </PrototypeNotice>
      <SectionHeading>Напоминания</SectionHeading>
      <EmptyPanel
        title="Настройка ещё не подключена"
        body="Будут доступны интервалы, тихие часы и история. Текущие значения не подменяются демонстрационными."
      />
    </PrototypeScreen>
  );
}
