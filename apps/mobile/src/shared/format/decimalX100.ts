/**
 * Число в сотых долях без единицы и без хвостовых нулей: 8800 → «88», 8840 → «88,4», 8835 → «88,35», −250 → «-2,5».
 * Общая чистая функция: её используют замеры и читающие модели, не загружая экраны.
 */
export function formatDecimal(valueX100: number): string {
  const sign = valueX100 < 0 ? "-" : "";
  const abs = Math.abs(valueX100);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  if (fraction === 0) return `${sign}${whole}`;
  return `${sign}${whole},${fraction % 10 === 0 ? String(fraction / 10) : String(fraction).padStart(2, "0")}`;
}
