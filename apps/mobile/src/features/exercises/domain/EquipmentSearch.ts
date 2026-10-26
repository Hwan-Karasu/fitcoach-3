import { equipmentLabel, KNOWN_EQUIPMENT } from "./ExerciseLabels.ts";
import { equipmentFilterKey, searchKey, type CatalogEntry } from "./ExerciseRules.ts";

const aliases: Readonly<Record<string, readonly string[]>> = {
  pec_deck: ["бабочка", "баттерфляй", "сведение рук", "разведение рук", "pec deck", "butterfly"],
  smith_machine: ["смит", "машина смита"], cable: ["блок", "кроссовер", "тяга блока"],
};
/** Options never depend on muscle filters, catalogue search or mode. */
export function equipmentChoices(entries: readonly CatalogEntry[], selected: readonly string[] = [], query = ""): readonly string[] {
  const label = (id: string) => id === "" ? "Оборудование не указано" : id === "none" ? "Без оборудования" : equipmentLabel(id);
  const words = searchKey(query).split(" ").filter(Boolean);
  return [...new Set([...KNOWN_EQUIPMENT, "none", ...entries.map((entry) => equipmentFilterKey(entry.definition)), ...selected])]
    .filter((id) => {
      const haystack = searchKey([id.replace(/_/gu, " "), label(id), ...(aliases[id] ?? [])].join(" "));
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => label(a).localeCompare(label(b), "ru"));
}
