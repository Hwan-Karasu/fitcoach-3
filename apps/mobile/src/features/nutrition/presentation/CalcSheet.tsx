import { BottomSheet } from "../../../shared/ui/components/public.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import { NutritionCalcScreen, type CalcClientBody, type SaveCalcProfile } from "./NutritionCalcScreen.tsx";

/**
 * «Расчёт» листом с «Главной» (UIX-05e, UI-OWN-073): прежний экран расчёта калорий и БЖУ открывается нижним листом, а не вкладкой питания.
 * Внутри профиль и активность, разбор расхода и процент жира; цель по БЖУ по-прежнему задаётся полями на «Главной».
 */
export function CalcSheet({ visible, clientId, body, onSaveProfile, onOpenJournal, calc, measurements, onClose }: Readonly<{
  visible: boolean; clientId: string; body: CalcClientBody; onSaveProfile: SaveCalcProfile; onOpenJournal: () => void;
  calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onClose: () => void;
}>) {
  return (
    <BottomSheet visible={visible} fill title="Расчёт" onClose={onClose}>
      <NutritionCalcScreen key={clientId} clientId={clientId} onOpenJournal={() => { onClose(); onOpenJournal(); }} body={body} onSaveProfile={onSaveProfile} calc={calc} measurements={measurements} />
    </BottomSheet>
  );
}
