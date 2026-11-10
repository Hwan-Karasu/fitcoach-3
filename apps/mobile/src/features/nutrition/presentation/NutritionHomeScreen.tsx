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
import { DayTabs } from "./DayTabs.tsx";
import { NutritionDiaryScreen } from "./NutritionDiaryScreen.tsx";
import { NutritionStatsScreen } from "./NutritionStatsScreen.tsx";

type Section = "diary" | "stats";
const sections = [{ id: "diary", label: "Дневник" }, { id: "stats", label: "Статистика" }] as const;

/** Главный экран «Питания»: Дневник / Статистика; расчёт и корректировка БЖУ — на главной клиента (UI-OWN-073). */
export function NutritionHomeScreen({ clientId, body, diary, targets, calc, measurements, onAdd, onEditSource, onOpenJournal }: Readonly<{
  clientId: string; body: CalcClientBody; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
  onEditSource?: (source: Readonly<{ kind: "FOOD" | "RECIPE"; id: string }>) => void;
  /** «Все записи» в статистике веса и % жира: журнал замеров. */
  onOpenJournal: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>("diary");
  const [visited, setVisited] = useState<Readonly<Partial<Record<Section, boolean>>>>({ diary: true });
  const selectSection = (next: Section) => { setVisited((current) => ({ ...current, [next]: true })); setSection(next); };
  // Дни закреплены сверху (как на «Главной») только в «Дневнике»: статистике веса день не нужен. Переключатель разделов — первая строка прокручиваемого содержимого.
  const switcher = <SegmentedControl compact items={sections} selectedId={section} onSelect={selectSection} />;
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      {section === "diary" ? <DayTabs /> : null}
      {visited.diary ? <View style={{ flex: 1, display: section === "diary" ? "flex" : "none" }}>
        <NutritionDiaryScreen key={clientId} clientId={clientId} diary={diary} targets={targets} body={body} calc={calc} measurements={measurements} onAdd={onAdd} onEditSource={onEditSource} leading={switcher} />
      </View> : null}
      {visited.stats ? <View style={{ flex: 1, display: section === "stats" ? "flex" : "none" }}>
        <NutritionStatsScreen key={clientId} clientId={clientId} measurements={measurements} onOpenJournal={onOpenJournal} leading={switcher} />
      </View> : null}
    </View>
  );
}
