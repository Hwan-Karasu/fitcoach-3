/**
 * Оценка процента жира по рисунку (UIX-06, UI-OWN-074): девять рисунков на пол, у каждого ориентировочный диапазон.
 * «Выбрать» подставляет в поле «Жир, %» середину диапазона (`pickX10`, десятые доли процента — без дробей). Это справочная оценка:
 * замер сохраняется методом `VISUAL_ESTIMATE` и не заменяет измерение.
 */
export type BodyFatPictureSet = "MALE" | "FEMALE";

export interface BodyFatPicture {
  /** Номер рисунка в наборе, 1…9: имя ресурса `bodyfat_<male|female>_<номер>`. */
  readonly index: number;
  /** Подпись под рисунком: «6–9», «40+». */
  readonly label: string;
  /** Подставляемое значение: середина диапазона в десятых долях процента. Последний рисунок («40+») — условная середина 40–44. */
  readonly pickX10: number;
}

const tile = (index: number, label: string, pickX10: number): BodyFatPicture => ({ index, label, pickX10 });

export const BODY_FAT_PICTURES: Readonly<Record<BodyFatPictureSet, readonly BodyFatPicture[]>> = {
  MALE: [tile(1, "6–9", 75), tile(2, "10–13", 115), tile(3, "14–17", 155), tile(4, "18–21", 195), tile(5, "22–25", 235),
    tile(6, "26–29", 275), tile(7, "30–34", 320), tile(8, "35–39", 370), tile(9, "40+", 420)],
  FEMALE: [tile(1, "14–17", 155), tile(2, "18–21", 195), tile(3, "22–25", 235), tile(4, "26–29", 275), tile(5, "30–33", 315),
    tile(6, "34–37", 355), tile(7, "38–41", 395), tile(8, "42–46", 440), tile(9, "47+", 485)],
};

/** Какой набор показывать: по полу клиента; пол не указан — набор не выбирается (сначала нужно выбрать пол). */
export function pictureSetOf(sex: "MALE" | "FEMALE" | null): BodyFatPictureSet | null {
  return sex === null ? null : sex;
}
