import { parseRublesToKopeks, pricePerSessionKopeks } from "./AccountingRules.ts";

export type PackPriceBasis = "TOTAL" | "SESSION";

/** Черновик денег: последнее явно изменённое денежное поле задаёт второе; количество не меняет источник цены. */
export function derivePackPricing(countText: string, totalText: string, sessionText: string, basis: PackPriceBasis): Readonly<{
  count: number | null;
  totalKopeks: number | "empty" | "invalid";
  totalText: string;
  sessionText: string;
}> {
  const rawCount = countText.trim();
  const count = /^\d{1,4}$/u.test(rawCount) && Number(rawCount) >= 1 && Number(rawCount) <= 1000 ? Number(rawCount) : null;
  const source = parseRublesToKopeks(basis === "TOTAL" ? totalText : sessionText);
  const moneyText = (kopeks: number) => {
    const remainder = kopeks % 100;
    return `${Math.trunc(kopeks / 100)}${remainder === 0 ? "" : `,${String(remainder).padStart(2, "0")}`}`;
  };
  if (basis === "TOTAL") return { count, totalKopeks: source, totalText,
    sessionText: count === null || typeof source !== "number" ? "" : moneyText(pricePerSessionKopeks(source, count)) };
  const total = count !== null && typeof source === "number" ? count * source : source === "empty" ? "empty" : "invalid";
  return { count, totalKopeks: total, totalText: typeof total === "number" ? moneyText(total) : "", sessionText };
}
