import { nullableText, object, text } from "../../../../shared/domain/JsonShape.ts";
import type { SessionOrigin } from "./TrainingExecutionPort.ts";
export const storedOrigin = (value: unknown): value is SessionOrigin => object(value) && text(value.programTitle)
  && (value.programKind === "SIMPLE" || value.programKind === "PERIODIZED") && nullableText(value.mesocycleTitle) && nullableText(value.workoutTitle);
