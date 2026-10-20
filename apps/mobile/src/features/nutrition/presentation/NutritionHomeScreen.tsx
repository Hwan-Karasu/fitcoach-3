import { useState } from "react";
import { View } from "react-native";
import { SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { MealSlot } from "../domain/DiaryModel.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import { NutritionCalcScreen, type CalcClientBody } from "./NutritionCalcScreen.tsx";
import type { CalcSex } from "../domain/CalcRules.ts";
import { NutritionDiaryScreen } from "./NutritionDiaryScreen.tsx";
import { NutritionStatsScreen } from "./NutritionStatsScreen.tsx";

type Section = "calc" | "diary" | "stats";
const sections = [{ id: "calc", label: "Расчёт" }, { id: "diary", label: "Дневник" }, { id: "stats", label: "Статистика" }] as const;

/** Главный экран «Питания»: Расчёт / Дневник / Статистика (§49.2). Цели — два ряда в «Расчёте»; дни недели, версии и исключения — отдельный экран «Цели по дням недели». */
export function NutritionHomeScreen({ clientId, body, onUpdateBody, diary, targets, calc, measurements, onAdd }: Readonly<{
  clientId: string; body: CalcClientBody; onUpdateBody: (patch: Readonly<{ sex: CalcSex | null; heightCm: number | null }>) => Promise<void>; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>("diary");
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SegmentedControl compact items={sections} selectedId={section} onSelect={setSection} /></View>
      {section === "calc" ? <NutritionCalcScreen clientId={clientId} body={body} onUpdateBody={onUpdateBody} calc={calc} measurements={measurements} />
        : section === "diary" ? <NutritionDiaryScreen clientId={clientId} diary={diary} targets={targets} onAdd={onAdd} />
        : <NutritionStatsScreen clientId={clientId} diary={diary} targets={targets} />}
    </View>
  );
}
