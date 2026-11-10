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
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { NutritionDiaryScreen } from "./NutritionDiaryScreen.tsx";
import { NutritionStatsScreen } from "./NutritionStatsScreen.tsx";

type Section = "diary" | "stats";
const sections = [{ id: "diary", label: "Дневник" }, { id: "stats", label: "Статистика" }] as const;

/** Главный экран «Питания»: Дневник / Статистика; расчёт и корректировка БЖУ — на главной клиента (UI-OWN-073). */
export function NutritionHomeScreen({ clientId, body, diary, targets, calc, measurements, onAdd, onEditSource }: Readonly<{
  clientId: string; body: CalcClientBody; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
  onEditSource?: (source: Readonly<{ kind: "FOOD" | "RECIPE"; id: string }>) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>("diary");
  const [visited, setVisited] = useState<Readonly<Partial<Record<Section, boolean>>>>({ diary: true });
  const [requestedDay, setRequestedDay] = useState<Readonly<{ date: string; token: number }> | undefined>(undefined);
  const selectSection = (next: Section) => { setVisited((current) => ({ ...current, [next]: true })); setSection(next); };
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SegmentedControl compact items={sections} selectedId={section} onSelect={selectSection} /></View>
      {visited.diary ? <View style={{ flex: 1, display: section === "diary" ? "flex" : "none" }}>
        <NutritionDiaryScreen key={clientId} clientId={clientId} diary={diary} targets={targets} body={body} calc={calc} measurements={measurements} onAdd={onAdd} onEditSource={onEditSource} requestedDay={requestedDay} />
      </View> : null}
      {visited.stats ? <View style={{ flex: 1, display: section === "stats" ? "flex" : "none" }}>
        <NutritionStatsScreen key={clientId} clientId={clientId} body={body} diary={diary} targets={targets} calc={calc} measurements={measurements}
          onOpenDay={(date) => { setRequestedDay((current) => ({ date, token: (current?.token ?? 0) + 1 })); selectSection("diary"); }} />
      </View> : null}
    </View>
  );
}
