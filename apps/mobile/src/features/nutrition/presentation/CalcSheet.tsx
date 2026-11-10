import { useState } from "react";
import { BottomSheet } from "../../../shared/ui/components/public.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import { NutritionCalcScreen, type CalcClientBody, type SaveCalcProfile } from "./NutritionCalcScreen.tsx";

/**
 * «Расчёт» листом с «Главной» (UIX-05e, UI-OWN-073): экран расчёта калорий открывается нижним листом, а не вкладкой питания.
 * «Профиль и активность» заменяет содержимое того же листа (заголовок меняется), «Готово» возвращает к расчёту; цель по БЖУ задаётся полями на «Главной».
 */
export function CalcSheet({ visible, clientId, body, onSaveProfile, calc, measurements, onClose }: Readonly<{
  visible: boolean; clientId: string; body: CalcClientBody; onSaveProfile: SaveCalcProfile;
  calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onClose: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  return (
    <BottomSheet visible={visible} fill title={editing ? "Профиль и активность" : "Расчёт"} onClose={onClose}>
      <NutritionCalcScreen key={clientId} clientId={clientId} body={body} onSaveProfile={onSaveProfile} calc={calc} measurements={measurements} onEditingChange={setEditing} />
    </BottomSheet>
  );
}
