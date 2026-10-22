/** Pure JSON shape predicates shared by domain validators. */
export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
export const text = (value: unknown): value is string => typeof value === "string";
export const id = (value: unknown): value is string => text(value) && value.trim().length > 0;
export const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
export const nullableInteger = (value: unknown): value is number | null => value === null || integer(value);
export const nullableText = (value: unknown): value is string | null => value === null || text(value);
export const arrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(guard);
