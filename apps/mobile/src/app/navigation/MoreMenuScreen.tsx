import { PrototypeLink, PrototypeNotice, PrototypeScreen } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { moreDestinations } from "./routeCatalog.ts";

export function MoreMenuScreen({
  onOpenQuestionnaire,
  onOpenArchive,
  onOpenStatistics,
}: Readonly<{
  onOpenQuestionnaire: () => void;
  onOpenArchive: () => void;
  onOpenStatistics: () => void;
}>) {
  return (
    <PrototypeScreen description="Другие разделы карточки клиента">
      <PrototypeNotice>
        Здесь показаны самостоятельные маршруты карточки. Это dev-демонстрация без выбранного клиента.
      </PrototypeNotice>
      <PrototypeLink title={moreDestinations.Questionnaire} detail="Сведения клиента" onPress={onOpenQuestionnaire} />
      <PrototypeLink title={moreDestinations.TrainingArchive} detail="История тренировок" onPress={onOpenArchive} />
      <PrototypeLink title={moreDestinations.Statistics} detail="Общая статистика клиента" onPress={onOpenStatistics} />
    </PrototypeScreen>
  );
}
