/**
 * Оценка процента жира по окружностям, метод ВМС США (§49.16 П11). Это оценка, а не измерение состава тела. Неполные, нулевые,
 * отрицательные или несовместимые данные и результат вне 2–75 % дают `null`, а не ноль.
 */
export interface NavyInput {
  readonly sex: "MALE" | "FEMALE" | null;
  readonly heightCm: number | null;
  readonly neckCm: number | null;
  readonly waistCm: number | null;
  /** Нужны только женщине. */
  readonly hipsCm: number | null;
}

const ok = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/** Процент жира с одной десятой или `null`. */
export function navyBodyFat(input: NavyInput): number | null {
  const { sex, heightCm, neckCm, waistCm, hipsCm } = input;
  if (sex === null || !ok(heightCm) || !ok(neckCm) || !ok(waistCm)) return null;
  let percent: number;
  if (sex === "MALE") {
    if (waistCm <= neckCm) return null;
    percent = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (!ok(hipsCm) || waistCm + hipsCm <= neckCm) return null;
    percent = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipsCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  }
  if (!Number.isFinite(percent) || percent < 2 || percent > 75) return null;
  return Math.round(percent * 10) / 10;
}
