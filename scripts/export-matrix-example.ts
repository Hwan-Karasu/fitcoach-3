import { mkdir, writeFile } from "node:fs/promises";
import { writeTrainingWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
await mkdir("artifacts/excel", { recursive: true });
await writeFile("artifacts/excel/Пример-матрицы.xlsx", writeTrainingWorkbook(trainingTransferFixture()));
console.log("Synthetic workbook: artifacts/excel/Пример-матрицы.xlsx");
