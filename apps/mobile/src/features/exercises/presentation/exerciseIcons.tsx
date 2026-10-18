import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Body, { type Slug } from "react-native-body-highlighter";
import { Armchair, Bike, Box, Cable, Circle, CircleDot, Cog, Disc3, Dumbbell, Footprints, HandFist, HandGrab, Hexagon,
  PersonStanding, RotateCw, Ship, Snowflake, Spline, Truck, Volleyball, Waves, Weight, type LucideIcon } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { BodyPart } from "../domain/ExerciseModel.ts";

/** Группа мышц на силуэте (UI-OWN-031): какие участки подсветить и с какой стороны смотреть. */
const bodyParts: Readonly<Record<BodyPart, Readonly<{ slugs: readonly Slug[]; side: "front" | "back" }>>> = {
  chest: { slugs: ["chest"], side: "front" },
  back: { slugs: ["upper-back", "lower-back", "trapezius"], side: "back" },
  shoulders: { slugs: ["deltoids"], side: "front" },
  upper_arms: { slugs: ["biceps", "triceps"], side: "front" },
  lower_arms: { slugs: ["forearm"], side: "front" },
  core: { slugs: ["abs", "obliques"], side: "front" },
  upper_legs: { slugs: ["quadriceps", "adductors"], side: "front" },
  lower_legs: { slugs: ["calves"], side: "back" },
  full_body: { slugs: ["chest", "abs", "obliques", "deltoids", "biceps", "forearm", "quadriceps", "adductors", "tibialis"], side: "front" },
};

/** Силуэт тела с подсвеченной группой — SVG; `scale` 0,17 даёт фигуру около 34×68. */
export function BodyPartIcon({ part, scale = 0.17 }: Readonly<{ part: BodyPart; scale?: number }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { slugs, side } = bodyParts[part];
  return (
    <View style={styles.figure}>
      <Body data={slugs.map((slug) => ({ slug, intensity: 1 }))} colors={[colors.accentInk]} side={side} scale={scale}
        border="none" defaultFill={colors.border} />
    </View>
  );
}

const equipment: Readonly<Record<string, LucideIcon>> = {
  none: PersonStanding, barbell: Dumbbell, dumbbell: Dumbbell, ez_bar: Dumbbell, trap_bar: Hexagon, kettlebell: Weight,
  plates: Disc3, cable: Cable, lat_pulldown_machine: Cable, suspension_trainer: Spline, resistance_band: Spline, loop_band: Spline,
  pull_up_bar: HandGrab, dip_station: HandFist, rings: Circle, climbing_rope: Waves, battle_rope: Waves, jump_rope: Waves,
  stability_ball: Volleyball, slam_ball: Volleyball, flat_bench: Armchair, plyo_box: Box, leg_press: Footprints,
  treadmill: Footprints, stair_climber: Footprints, stationary_bike: Bike, air_bike: Bike, rower: Ship, ski_erg: Snowflake,
  elliptical: RotateCw, wrist_roller: RotateCw, ab_wheel: CircleDot, sled: Truck,
};

/** Значок оборудования (lucide); узкие тренажёры — общая шестерёнка. */
export function equipmentIcon(id: string, color: string, size = 18): ReactNode {
  const Icon = equipment[id] ?? Cog;
  return <Icon size={size} color={color} strokeWidth={1.8} />;
}

const styles = StyleSheet.create({
  figure: { alignItems: "center", justifyContent: "center" },
});
