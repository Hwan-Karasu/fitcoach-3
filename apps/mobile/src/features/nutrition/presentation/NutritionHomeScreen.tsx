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
import { NutritionTargetsScreen } from "./NutritionTargetsScreen.tsx";

type Section = "calc" | "diary" | "targets" | "stats";
const sections = [{ id: "calc", label: "Расчёт" }, { id: "diary", label: "Дневник" }, { id: "targets", label: "Цели" }, { id: "stats", label: "Статистика" }] as const;

/** Главный экран «Питания»: Расчёт / Дневник / Цели / Статистика (§49.2: «Расчёт / Дневник / Статистика» + утверждённые цели-коридоры 3.0). */
export function NutritionHomeScreen({ clientId, body, onUpdateBody, diary, targets, calc, measurements, onAdd }: Readonly<{
  clientId: string; body: CalcClientBody; onUpdateBody: (patch: Readonly<{ sex: CalcSex | null; heightCm: number | null }>) => Promise<void>; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>("diary");
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SegmentedControl compact items={sections} selectedId={section} onSelect={setSection} /></View>
      {section === "calc" ? <NutritionCalcScreen clientId={clientId} body={body} onUpdateBody={onUpdateBody} calc={calc} targets={targets} measurements={measurements} />
        : section === "diary" ? <NutritionDiaryScreen clientId={clientId} diary={diary} targets={targets} onAdd={onAdd} />
        : section === "targets" ? <NutritionTargetsScreen clientId={clientId} targets={targets} />
          : <NutritionStatsScreen clientId={clientId} diary={diary} targets={targets} />}
    </View>
  );
}
