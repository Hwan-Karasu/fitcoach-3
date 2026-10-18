import { StyleSheet, View } from "react-native";
import Body, { type Slug } from "react-native-body-highlighter";
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

/** Силуэт тела с подсвеченной группой — SVG; `scale` 0,21 даёт фигуру около 42×84. */
export function BodyPartIcon({ part, scale = 0.21 }: Readonly<{ part: BodyPart; scale?: number }>) {
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

const styles = StyleSheet.create({
  figure: { alignItems: "center", justifyContent: "center" },
});
