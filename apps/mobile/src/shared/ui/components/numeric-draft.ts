export type DecimalPolicy = "integer" | "decimal";
export type NumericDraft =
  | { readonly kind: "empty" }
  | { readonly kind: "incomplete" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly value: number };

// Parsing is separate from typing: a comma, trailing separator or minus sign must not erase a draft.
export function parseNumericDraft(rawValue: string, policy: DecimalPolicy = "decimal"): NumericDraft {
  const value = rawValue.trim();
  if (!value) return { kind: "empty" };
  if (value === "-" || (policy === "decimal" && /^-?(?:[.,]|\d+[.,])$/u.test(value))) {
    return { kind: "incomplete" };
  }
  const pattern = policy === "integer" ? /^-?\d+$/u : /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u;
  if (!pattern.test(value)) return { kind: "invalid" };
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? { kind: "valid", value: parsed } : { kind: "invalid" };
}
