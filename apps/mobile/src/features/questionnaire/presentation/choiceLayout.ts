/**
 * Число столбцов сетки пилюль по самим вариантам: шкала 1–10 — один ряд; короткий выбор («Да/Нет», пол) — один ряд;
 * короткие слова — три столбца; остальное — два. Подписи не режутся: длинные переносятся внутри пилюли.
 */
export function choiceColumns(labels: readonly string[]): number {
  const count = labels.length;
  if (count <= 1) return 1;
  const longest = Math.max(...labels.map((label) => label.length));
  if (count >= 5 && longest <= 2) return count;
  if (count <= 3 && longest <= 14) return count;
  if (longest <= 9) return 3;
  if (count <= 6 && longest <= 14) return 3;
  return 2;
}
