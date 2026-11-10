import type { TransferSet } from "./TrainingTransfer.ts";
export function parseMatrixPlan(text: string): Omit<TransferSet, "id"> {
  const result = { reps: null, repsMax: null, loadGrams: null, durationSec: null, distanceM: null } as { -readonly [K in keyof Omit<TransferSet, "id">]: Omit<TransferSet, "id">[K] };
  if (!text.trim() || text.trim() === "—") return result;
  for (const part of text.trim().split(/\s*[×*]\s*/u)) {
    const range = /^(\d+)(?:\s*[-–]\s*(\d+))?$/u.exec(part);
    if (range) { if (result.reps !== null) throw new Error("Повторы указаны дважды."); result.reps = Number(range[1]); result.repsMax = range[2] ? Number(range[2]) : null; continue; }
    const unit = /^(\d+(?:[.,]\d+)?)\s*(кг|с|м)$/u.exec(part);
    if (!unit) throw new Error("План: используйте «8–10 × 62,5 кг», при необходимости добавьте «× 60 с × 100 м».");
    const field = unit[2] === "кг" ? "loadGrams" : unit[2] === "с" ? "durationSec" : "distanceM";
    if (result[field] !== null) throw new Error("Плановая величина указана дважды.");
    const value = Number(unit[1]!.replace(",", ".")) * (field === "loadGrams" ? 1000 : 1);
    // Граммы округляются (1,1 кг × 1000 = 1100.0000000000002); секунды и метры — только целые.
    if (field !== "loadGrams" && !Number.isInteger(value)) throw new Error("План: секунды и метры — целые числа.");
    result[field] = field === "loadGrams" ? Math.round(value) : value;
  }
  return result;
}
