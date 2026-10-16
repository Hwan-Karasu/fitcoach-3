import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(projectRoot, "..", "FitCoach_3_DOCUMENTS_SYNCED_2026-10-14");
const featureDir = path.join(sourceRoot, "04-Feature-Specifications", "features");

const product = await sourceText("01-Product-Contract/PRODUCT_CONTRACT_SYNCED.md");
const productHash = createHash("sha256").update(
  await readFile(path.join(sourceRoot, "01-Product-Contract", "PRODUCT_CONTRACT_SYNCED.md")),
).digest("hex");
if (productHash !== "4b95fb2fe457571af9b353bda727b1a0e331eb0048ca69a2228756d800ad9442") {
  throw new Error("Product Contract changed during S02 correction");
}
for (const section of ["53", "54", "55", "56"]) {
  if (!new RegExp(`^# ${section}\\.`, "mu").test(product)) {
    throw new Error(`Product §${section} not found`);
  }
}

const syncedDocuments = [
  "02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md",
  "03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md",
  "04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md",
  "05-UI-UX/UI_UX_DESIGN_SYNCED.md",
  "06-Implementation/IMPLEMENTATION_PLAN_SYNCED.md",
] as const;
for (const file of syncedDocuments) {
  const content = await sourceText(file);
  if (!content.includes("Синхронизированный реестр обязательных решений (Product §§53–56)")) {
    throw new Error(`Late-decision registry missing: ${file}`);
  }
}

const featureFiles = (await readdir(featureDir)).filter((file) => /^\d{2}-.*\.md$/u.test(file));
if (featureFiles.length !== 20) throw new Error(`Expected 20 feature specs, found ${featureFiles.length}`);
for (let index = 1; index <= 20; index += 1) {
  const prefix = `${String(index).padStart(2, "0")}-`;
  const file = featureFiles.find((candidate) => candidate.startsWith(prefix));
  if (!file) throw new Error(`Feature ${prefix} missing`);
  const content = await readFile(path.join(featureDir, file), "utf8");
  if (!content.includes("Актуальный перекрёстный норматив 2026-10-14")) {
    throw new Error(`Late-decision addendum missing in ${file}`);
  }
  const productSources = content.match(/^\*\*Product sources:\*\* (.+)$/mu)?.[1];
  if (!productSources?.includes("§§53–56")) {
    throw new Error(`Product §§53–56 missing from ${file} sources`);
  }
  if (!content.includes("4b95fb2fe457571af9b353bda727b1a0e331eb0048ca69a2228756d800ad9442")) {
    throw new Error(`Current Product checksum missing from ${file}`);
  }
}

const knownStale: readonly [string, string][] = [
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "фиксированный визуал «Главной»"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "Главная [визуал по build120 §51]"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "Продуктовый visual freeze §51 сильнее"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "Неудачная адаптация замороженной Главной"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "Read source adaptation, visual baseline locked"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "visual regression по §51"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "фиксированный визуал «Главной»"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "Главная [визуал по build120 §51]"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "Продуктовый visual freeze §51 сильнее"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "Неудачная адаптация замороженной Главной"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "Read source adaptation, visual baseline locked"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "visual regression по §51"],
  ["03-Data-Technical/design-notes/04-STACK-VERSION-MATRIX.md", "light/dark, responsive, accessibility; frozen Home"],
  ["03-Data-Technical/design-notes/07-TECH-RISKS-AND-SPIKES.md", "T18 frozen Home"],
  ["04-Feature-Specifications/features/01-app-shell.md", "GetClientStartTabPreference()"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "GetClientStartTabPreferences()"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "GetClientStartTabPreference()"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "GetClientStartTabPreferences()"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "GetClientStartTabPreference()"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "GetClientStartTabPreferences()"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "Нужен визуальный comparison baseline for build120"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "Нужен визуальный comparison baseline for build120"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "Нужен визуальный comparison baseline for build120"],
  ["03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md", "TrainerRoot (4 tabs:"],
  ["03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md", "Нельзя ради неё редизайнить frozen Главную"],
  ["03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md", "переключения четырёх root tabs"],
  ["03-Data-Technical/design-notes/03-STATE-AND-NAVIGATION.md", "TrainerRoot (4 tabs:"],
  ["03-Data-Technical/design-notes/03-STATE-AND-NAVIGATION.md", "Нельзя ради неё редизайнить frozen Главную"],
  ["03-Data-Technical/design-notes/03-STATE-AND-NAVIGATION.md", "переключения четырёх root tabs"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "Четыре root-вкладки:"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "Ранее утверждённый визуальный вид Главной сохраняется"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "tab:'clients'|'calendar'|'archive'|'settings'"],
  ["04-Feature-Specifications/features/01-app-shell.md", "Четыре root-вкладки:"],
  ["04-Feature-Specifications/features/01-app-shell.md", "Ранее утверждённый визуальный вид Главной сохраняется"],
  ["04-Feature-Specifications/features/01-app-shell.md", "tab:'clients'|'calendar'|'archive'|'settings'"],
  ["04-Feature-Specifications/features/14-nutrition-diary.md", "Визуальная Главная клиента остаётся прежней"],
  ["04-Feature-Specifications/features/15-nutrition-targets-measurements.md", "На Главной, не меняя композиции"],
  ["04-Feature-Specifications/features/15-nutrition-targets-measurements.md", "Home сохраняет прежнюю композицию"],
  ["04-Feature-Specifications/features/15-nutrition-targets-measurements.md", "в старой Главной обязательны"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "Визуальная Главная клиента остаётся прежней"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "На Главной, не меняя композиции"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "Home сохраняет прежнюю композицию"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "в старой Главной обязательны"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "Визуальная Главная клиента остаётся прежней"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "На Главной, не меняя композиции"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "Home сохраняет прежнюю композицию"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "в старой Главной обязательны"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "ClientWorkspaceTab"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "ClientWorkspaceTab"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "ClientWorkspaceTab"],
  ["03-Data-Technical/design-notes/08-TRACEABILITY-AND-HANDOFF.md", "visual Home frozen, change read source only"],
  ["04-Feature-Specifications/docs/03-RISKS-AND-GATES.md", "unchanged layout mandate §51"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "unchanged layout mandate §51"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "unchanged layout mandate §51"],
];

for (const [file, phrase] of knownStale) {
  const content = await sourceText(file);
  if (content.includes(phrase)) {
    throw new Error(`Superseded S02 text remains: ${file} :: ${phrase}`);
  }
}

const corrected: readonly [string, string][] = [
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "Отдельные маршруты: Настройки (через меню), Центр уведомлений (Bell)"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md", "четыре нижних контрола и три раздела в «Ещё»"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "Отдельные маршруты: Настройки (через меню), Центр уведомлений (Bell)"],
  ["02-Architecture/ARCHITECTURE_DESIGN_SYNCED.html", "четыре нижних контрола и три раздела в «Ещё»"],
  ["03-Data-Technical/design-notes/04-STACK-VERSION-MATRIX.md", "9×3 themes, responsive, accessibility; Client Home fully redesigned"],
  ["03-Data-Technical/design-notes/07-TECH-RISKS-AND-SPIKES.md", "T18 full Client Home redesign"],
  ["04-Feature-Specifications/features/01-app-shell.md", "GetClientStartSectionPreference()"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "GetClientStartSectionPreference()"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "его скриншот не является визуальным эталоном"],
  ["03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md", "TrainerRoot (3 tabs: Клиенты, Календарь, Архив)"],
  ["03-Data-Technical/design-notes/03-STATE-AND-NAVIGATION.md", "TrainerRoot (3 tabs: Клиенты, Календарь, Архив)"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md", "type RootTab = 'clients'|'calendar'|'archive';"],
  ["04-Feature-Specifications/features/01-app-shell.md", "type RootTab = 'clients'|'calendar'|'archive';"],
  ["04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.html", "type RootTab = 'clients'|'calendar'|'archive';"],
  ["03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.html", "TrainerRoot (3 tabs: Клиенты, Календарь, Архив)"],
  ["06-Implementation/TASK_BACKLOG.csv", "Product §§2,53; ARCH ADR-A08; TECH Stage3 §03"],
  ["06-Implementation/IMPLEMENTATION_PLAN_SYNCED.md", "Product §§2,53; ARCH ADR-A08; TECH Stage3 §03"],
  ["06-Implementation/IMPLEMENTATION_PLAN_SYNCED.html", "Product §§2,53; ARCH ADR-A08; TECH Stage3 §03"],
  ["06-Implementation/runbook/FitCoach_3_Implementation_Plan_v1_0_2026-10-14_UTF8_BOM.md", "Product §§2,53; ARCH ADR-A08; TECH Stage3 §03"],
  ["04-Feature-Specifications/features/14-nutrition-diary.md", "Главная клиента полностью редизайнится по Product §53.4"],
  ["04-Feature-Specifications/features/15-nutrition-targets-measurements.md", "после полного редизайна Home показывает действующий диапазон целей"],
  ["04-Feature-Specifications/features/16-client-home-settings.md", "setClientStartSection(section:ClientSection"],
  ["03-Data-Technical/design-notes/08-TRACEABILITY-AND-HANDOFF.md", "§§51,53.4,56.2"],
  ["04-Feature-Specifications/docs/03-RISKS-AND-GATES.md", "Историческое требование §51 сохранять прежнюю композицию отменено"],
];
for (const [file, phrase] of corrected) {
  if (!(await sourceText(file)).includes(phrase)) {
    throw new Error(`S02 correction missing: ${file} :: ${phrase}`);
  }
}

const backlog = await sourceText("06-Implementation/TASK_BACKLOG.json");
const tasks: unknown = JSON.parse(backlog);
if (!isBacklog(tasks)) throw new Error("Unexpected backlog shape");
const r08 = tasks.tasks.find((task) => task.id === "R08");
if (r08?.refs !== "Product §§2,53; ARCH ADR-A08; TECH Stage3 §03") {
  throw new Error("R08 navigation reference is not corrected");
}

console.log(
  `S02 audit: Product §§53–56 present; ${syncedDocuments.length} top-level registries; ` +
  `${featureFiles.length}/20 feature addenda; ${knownStale.length} superseded body locations removed; ` +
  "R08 refs corrected; Product hash unchanged. Manual semantic review and UI/Android gates remain open.",
);

async function sourceText(relativePath: string): Promise<string> {
  return await readFile(path.join(sourceRoot, relativePath), "utf8");
}

function isBacklog(value: unknown): value is { tasks: { id: string; refs: string }[] } {
  if (typeof value !== "object" || value === null || !("tasks" in value)) return false;
  return Array.isArray(value.tasks) && value.tasks.every(
    (task: unknown) => typeof task === "object" && task !== null &&
      "id" in task && typeof task.id === "string" &&
      "refs" in task && typeof task.refs === "string",
  );
}
