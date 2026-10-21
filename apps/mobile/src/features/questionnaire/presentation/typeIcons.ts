import { CalendarDays, CircleDot, Hash, SquareCheck, TextAlignStart, ToggleLeft, Type, type LucideIcon } from "lucide-react-native";
import type { QuestionType } from "../domain/QuestionnaireModel.ts";

/** Значки типов ответа: меню «Тип ответа нового вопроса» и выбор типа в редакторе вопроса. */
export const typeIcons: Readonly<Record<QuestionType, LucideIcon>> = { SHORT_TEXT: Type, LONG_TEXT: TextAlignStart, NUMBER: Hash,
  DATE: CalendarDays, SINGLE_CHOICE: CircleDot, MULTI_CHOICE: SquareCheck, SWITCH: ToggleLeft };
