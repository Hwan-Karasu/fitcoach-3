import { BODY_PARTS, TRACKING_PROFILE_IDS, type BodyPart, type ExerciseDefinition,
  type TrackingProfileId } from "./ExerciseModel.ts";

/** §39.2 Личный слой тренера поверх упражнения: не смешивается с каноническими данными. */
export interface ExerciseOverlay {
  readonly favorite: boolean;
  readonly hidden: boolean;
  readonly displayName: string | null;
  readonly aliases: readonly string[];
}

export const EMPTY_OVERLAY: ExerciseOverlay = { favorite: false, hidden: false, displayName: null, aliases: [] };

export interface CatalogEntry {
  readonly definition: ExerciseDefinition;
  readonly overlay: ExerciseOverlay;
}

/** §31.5 Быстрые режимы списка. «Недавние» появятся вместе с выбором упражнения в программу. */
export type CatalogMode = "ALL" | "FAVORITES" | "MINE";

/** §31.6 Расширенные фильтры. Пустое множество — без ограничения. */
export interface CatalogFilters {
  readonly bodyParts: ReadonlySet<BodyPart>;
  readonly equipment: ReadonlySet<string>;
  readonly profiles: ReadonlySet<TrackingProfileId>;
  readonly showHidden: boolean;
}

export const NO_FILTERS: CatalogFilters = { bodyParts: new Set(), equipment: new Set(), profiles: new Set(), showHidden: false };

export function displayNameOf(entry: CatalogEntry): string {
  return entry.overlay.displayName?.trim() || entry.definition.name;
}

/** Для поиска: регистр, «ё», кавычки и дефисы не важны. */
export function searchKey(text: string): string {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[«»"'’().,:;!?-]/g, " ").replace(/\s+/g, " ").trim();
}

/** §31.4 Поиск по русскому и английскому названию, личному названию и синонимам: все слова запроса. */
export function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const words = searchKey(query).split(" ").filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const haystack = searchKey([entry.definition.name, entry.definition.nameEn ?? "", entry.overlay.displayName ?? "",
    ...entry.overlay.aliases].join(" "));
  return words.every((word) => haystack.includes(word));
}

export function activeFilterCount(filters: CatalogFilters): number {
  return filters.bodyParts.size + filters.equipment.size + filters.profiles.size + (filters.showHidden ? 1 : 0);
}

export function filterCatalog(entries: readonly CatalogEntry[], query: string, mode: CatalogMode,
  filters: CatalogFilters): readonly CatalogEntry[] {
  return entries.filter((entry) => {
    const { definition, overlay } = entry;
    if (overlay.hidden && !filters.showHidden) return false;
    if (mode === "FAVORITES" && !overlay.favorite) return false;
    if (mode === "MINE" && definition.origin !== "CUSTOM") return false;
    if (filters.bodyParts.size > 0 && !filters.bodyParts.has(definition.bodyPart)) return false;
    if (filters.equipment.size > 0 && !filters.equipment.has(definition.equipment ?? "none")) return false;
    if (filters.profiles.size > 0 && !filters.profiles.has(definition.trackingProfile)) return false;
    return matchesQuery(entry, query);
  });
}

/** По алфавиту без учёта кавычек: «Мёртвый жук» стоит на «М», а не в начале списка. */
export function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  const key = (entry: CatalogEntry) => displayNameOf(entry).replace(/[«»"]/g, "");
  return key(a).localeCompare(key(b), "ru");
}

export interface CustomExerciseInput {
  readonly name: string;
  readonly bodyPart: BodyPart | null;
  readonly equipment: string | null;
  readonly trackingProfile: TrackingProfileId | null;
}

export const EXERCISE_NAME_MAX = 80;

/** Своё упражнение: название и группа мышц (категория) обязательны, профиль — из разрешённых V1. */
export function validateCustom(input: CustomExerciseInput): Readonly<{ name: string; bodyPart: BodyPart;
  equipment: string | null; trackingProfile: TrackingProfileId }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > EXERCISE_NAME_MAX) throw new Error("EXERCISE_NAME_INVALID");
  if (input.bodyPart === null || !BODY_PARTS.includes(input.bodyPart)) throw new Error("EXERCISE_CATEGORY_REQUIRED");
  if (input.trackingProfile === null || !TRACKING_PROFILE_IDS.includes(input.trackingProfile)) {
    throw new Error("EXERCISE_PROFILE_REQUIRED");
  }
  return { name, bodyPart: input.bodyPart, equipment: input.equipment, trackingProfile: input.trackingProfile };
}

/** Синонимы: без пустых и повторов (без учёта регистра), не длиннее названия. */
export function normalizeAliases(aliases: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const value = alias.trim().replace(/\s+/g, " ").slice(0, EXERCISE_NAME_MAX);
    const key = searchKey(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
