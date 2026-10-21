import { useEffect, useState } from "react";
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

/** Главный экран «Питания»: Расчёт / Дневник / Статистика; корректировка БЖУ находится на главной клиента. */
export function NutritionHomeScreen({ clientId, body, onUpdateBody, onOpenJournal, diary, targets, calc, measurements, onAdd, requestedSection, sectionRequestKey }: Readonly<{
  requestedSection?: Section; sectionRequestKey?: number;
  clientId: string; onOpenJournal: () => void; body: CalcClientBody; onUpdateBody: (patch: Readonly<{ sex: CalcSex | null; heightCm: number | null }>) => Promise<void>; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const [section, setSection] = useState<Section>(requestedSection ?? "diary");
  const [visited, setVisited] = useState<Readonly<Partial<Record<Section, boolean>>>>({ [requestedSection ?? "diary"]: true });
  const [requestedDay, setRequestedDay] = useState<Readonly<{ date: string; token: number }> | undefined>(undefined);
  const selectSection = (next: Section) => { setVisited((current) => ({ ...current, [next]: true })); setSection(next); };
  useEffect(() => {
    if (requestedSection !== undefined) { setVisited((current) => ({ ...current, [requestedSection]: true })); setSection(requestedSection); }
  }, [requestedSection, sectionRequestKey]);
  return (
    <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SegmentedControl compact items={sections} selectedId={section} onSelect={selectSection} /></View>
      {visited.calc ? <View style={{ flex: 1, display: section === "calc" ? "flex" : "none" }}>
        <NutritionCalcScreen key={clientId} clientId={clientId} onOpenJournal={onOpenJournal} body={body} onUpdateBody={onUpdateBody} calc={calc} measurements={measurements} />
      </View> : null}
      {visited.diary ? <View style={{ flex: 1, display: section === "diary" ? "flex" : "none" }}>
        <NutritionDiaryScreen key={clientId} clientId={clientId} diary={diary} targets={targets} body={body} calc={calc} measurements={measurements} onAdd={onAdd} requestedDay={requestedDay} />
      </View> : null}
      {visited.stats ? <View style={{ flex: 1, display: section === "stats" ? "flex" : "none" }}>
        <NutritionStatsScreen key={clientId} clientId={clientId} diary={diary} targets={targets} calc={calc} measurements={measurements}
          onOpenDay={(date) => { setRequestedDay((current) => ({ date, token: (current?.token ?? 0) + 1 })); selectSection("diary"); }} />
      </View> : null}
    </View>
  );
}
