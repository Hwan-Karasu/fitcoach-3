import { useState } from "react";
import { View } from "react-native";
import { SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { MealSlot } from "../domain/DiaryModel.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { NutritionDiaryScreen } from "./NutritionDiaryScreen.tsx";
import { NutritionStatsScreen } from "./NutritionStatsScreen.tsx";
import { NutritionTargetsScreen } from "./NutritionTargetsScreen.tsx";

type Section = "diary" | "targets" | "stats";
const sections = [{ id: "diary", label: "Дневник" }, { id: "targets", label: "Цели" }, { id: "stats", label: "Статистика" }] as const;

/** Главный экран «Питания»: Дневник / Цели / Статистика (структура вкладок FitCoach 2.0, §49.2: «Расчёт / Дневник / Статистика»). */
export function NutritionHomeScreen({ clientId, diary, targets, onAdd }: Readonly<{
  clientId: string; diary: NutritionDiaryPort; targets: NutritionTargetsPort; onAdd: (localDate: string, slot: MealSlot) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>("diary");
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SegmentedControl items={sections} selectedId={section} onSelect={setSection} /></View>
      {section === "diary" ? <NutritionDiaryScreen clientId={clientId} diary={diary} targets={targets} onAdd={onAdd} />
        : section === "targets" ? <NutritionTargetsScreen clientId={clientId} targets={targets} />
          : <NutritionStatsScreen clientId={clientId} diary={diary} targets={targets} />}
    </View>
  );
}
