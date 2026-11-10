import { View } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { MealSlot } from "../domain/DiaryModel.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { DayTabs } from "./DayTabs.tsx";
import { NutritionDiaryScreen } from "./NutritionDiaryScreen.tsx";

/**
 * Главный экран «Питания» — «Дневник»: дни закреплены сверху, под ними итоги и приёмы. Статистика веса и % жира — отдельный экран,
 * его открывает значок в шапке (UI-OWN-086): переключателя разделов на экране нет, поэтому содержимое не «прыгает». Расчёт и корректировка БЖУ — на главной клиента (UI-OWN-073).
 */
export function NutritionHomeScreen({ clientId, body, diary, targets, calc, measurements, onAdd, onEditSource }: Readonly<{
  clientId: string; body: CalcClientBody; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
  onEditSource?: (source: Readonly<{ kind: "FOOD" | "RECIPE"; id: string }>) => void;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <DayTabs />
      <NutritionDiaryScreen key={clientId} clientId={clientId} diary={diary} targets={targets} body={body} calc={calc} measurements={measurements} onAdd={onAdd} onEditSource={onEditSource} />
    </View>
  );
}
