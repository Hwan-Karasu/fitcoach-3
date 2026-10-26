import type { TrainingTransfer } from "./TrainingTransfer.ts";

/** Keep the shared file name readable and safe on Android and Windows. */
export function trainingWorkbookFilename(value: TrainingTransfer): string {
  const clean = (text: string) => Array.from(text, (c) => c.charCodeAt(0) < 32 ? " " : c).join("").replace(/[<>:"/\\|?*]/gu, " ").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
  const programs = value.programs.map((p) => clean(p.title)).filter(Boolean).join("; ") || "Программа";
  const parts = [clean(value.client.name) || "Клиент", programs];
  if (value.programs.length === 1) { const p = value.programs[0]!; if (p.mesocycles.length === 1 && p.mesocycles[0]!.title !== p.title) parts.push(clean(p.mesocycles[0]!.title)); }
  const text = parts.filter(Boolean).join(" — "); let bytes = 0; let name = "";
  for (const character of text) { const code = character.codePointAt(0)!; const size = code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1; if (bytes + size > 220) break; name += character; bytes += size; }
  return `${name.trim().replace(/[. ]+$/u, "")}.xlsx`;
}
