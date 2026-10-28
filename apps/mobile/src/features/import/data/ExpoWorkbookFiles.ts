import { Directory, File, Paths } from "expo-file-system";
import { getDocumentAsync } from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { WorkbookFilesPort } from "../domain/WorkbookFilesPort.ts";
import { readWorkbook, readTrainingWorkbook } from "./TrainingWorkbook.ts";
import { writeVisibleTrainingWorkbook } from "./VisibleMatrixWorkbook.ts";
import { flattenLegacyMatrix } from "../domain/LegacyMatrix.ts";
import { IMPORT_SAMPLE_FILENAME, IMPORT_SAMPLE_SHEET, importSampleSheet } from "../domain/ImportSample.ts";
import { transferReviewScopes } from "../domain/TrainingTransferReview.ts";
import { visibleTrainingTransfer } from "../../../shared/training-transfer/VisibleTrainingTransfer.ts";
import { trainingWorkbookFilename } from "../../../shared/training-transfer/WorkbookFilename.ts";

async function share(bytes: Uint8Array, filename: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error("Сохранение файлов недоступно на этом устройстве.");
  const directory = new Directory(Paths.cache, `training-excel-${Date.now()}-${Math.random().toString(16).slice(2)}`); directory.create();
  const file = new File(directory, filename);
  file.create();
  file.write(bytes);
  // The receiving application may read the granted URI after the chooser returns.
  // Keep the cache file alive; Android owns cache eviction.
  await Sharing.shareAsync(file.uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dialogTitle: "Сохранить тренировки Excel" });
}
export const expoWorkbookFiles: WorkbookFilesPort = {
  async pick(options) {
    const result = await getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/octet-stream"], copyToCacheDirectory: true });
    if (result.canceled) return null;
    if (options?.active && !options.active()) return null;
    await options?.onReading?.();
    const asset = result.assets[0]!;
    const file = new File(asset.uri);
    try {
      if (!/\.xlsx?$/iu.test(asset.name) || file.size > 20 * 1024 * 1024) throw new Error("Выберите Excel-файл размером до 20 МБ.");
      const bytes = await file.bytes(); const book = readWorkbook(bytes);
      if (book.SheetNames.includes("Формат")) {
        const value = visibleTrainingTransfer(readTrainingWorkbook(book));
        const links = book.Sheets["__Матрица"] ? XLSX.utils.sheet_to_json<{ json: string }>(book.Sheets["__Матрица"]!).map((row) => JSON.parse(row.json) as { programId: string; cycleId: string | null; sheet: string }) : [];
        const planSheets = transferReviewScopes(value).filter((scope) => scope.programId !== null).map((scope) => ({ scopeId: scope.id,
          name: links.find((link) => JSON.stringify([link.programId, link.cycleId ?? "simple"]) === scope.id)?.sheet ?? scope.title }));
        const position = (name: string) => { const index = book.SheetNames.indexOf(name); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
        planSheets.sort((a, b) => position(a.name) - position(b.name));
        return { kind: "TRANSFER", value, planSheets, filename: asset.name };
      }
      const tables = [];
      for (const name of book.SheetNames) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (options?.active && !options.active()) return null;
        const table = { name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, defval: "", raw: false }) };
        tables.push(flattenLegacyMatrix(table) ?? table);
      }
      return { kind: "TABLES", filename: asset.name, sourceId: `excel:${bytesToHex(sha256(bytes))}`, tables };
    } finally { if (file.uri.startsWith(`${Paths.cache.uri.replace(/\/$/u, "")}/`) && file.exists) file.delete(); }
  },
  share: (value) => share(writeVisibleTrainingWorkbook(value), trainingWorkbookFilename(value)),
  async template() {
    const book = XLSX.utils.book_new();
    const { rows, merges } = importSampleSheet();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!merges"] = merges.map((merge) => ({ s: { r: merge.r, c: merge.c0 }, e: { r: merge.r, c: merge.c1 } }));
    sheet["!cols"] = [{ wch: 30 }, { wch: 9 }, ...Array.from({ length: 3 }, () => [{ wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }]).flat()];
    XLSX.utils.book_append_sheet(book, sheet, IMPORT_SAMPLE_SHEET);
    const bytes: unknown = XLSX.write(book, { type: "array", bookType: "xlsx" });
    await share(new Uint8Array(bytes as ArrayBuffer), IMPORT_SAMPLE_FILENAME);
  },
};
