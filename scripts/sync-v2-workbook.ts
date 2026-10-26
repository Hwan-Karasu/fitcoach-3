import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "../FitCoach_2_Excel/apps/mobile/src");
for (const [from, to] of [
  ["shared/training-transfer/TrainingTransfer.ts", "shared/training-transfer/TrainingTransfer.ts"],
  ["shared/training-transfer/SpreadsheetDay.ts", "shared/training-transfer/SpreadsheetDay.ts"],
  ["shared/training-transfer/VisibleTrainingTransfer.ts", "shared/training-transfer/VisibleTrainingTransfer.ts"],
  ["shared/training-transfer/MatrixPlan.ts", "shared/training-transfer/MatrixPlan.ts"],
  ["shared/training-transfer/WorkbookFilename.ts", "shared/training-transfer/WorkbookFilename.ts"],
  ["features/import/data/VisibleMatrixWorkbook.ts", "features/training/export/VisibleMatrixWorkbook.ts"],
  ["features/import/data/TrainingWorkbook.ts", "features/training/export/TrainingWorkbook.ts"],
  ["features/import/data/MatrixWorkbook.ts", "features/training/export/MatrixWorkbook.ts"],
  ["features/import/data/TransferIssues.ts", "features/training/export/TransferIssues.ts"],
] as const) {
  const destination = resolve(target, to); await mkdir(resolve(destination, ".."), { recursive: true });
  const contents = (await readFile(resolve(root, "apps/mobile/src", from), "utf8")).replace(/(from\s+"[^"\r\n]+)\.ts"/gu, '$1"');
  await writeFile(destination, contents, "utf8");
}
console.log("Shared workbook contract synchronized to the isolated 2.0 branch.");
