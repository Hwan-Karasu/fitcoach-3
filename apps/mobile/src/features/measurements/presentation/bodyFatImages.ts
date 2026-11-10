/* eslint-disable @typescript-eslint/no-require-imports */
import type { BodyFatPictureSet } from "../domain/BodyFatPictures.ts";

/** Рисунки процента жира (UIX-06): 9 плиток одного размера 360×540 на набор; порядок — как в `BODY_FAT_PICTURES`. Файл создан нарезкой двух исходных сеток. */
export const bodyFatImages: Readonly<Record<BodyFatPictureSet, readonly number[]>> = {
  MALE: [
    require("../../../../assets/bodyfat/bodyfat_male_1.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_2.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_3.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_4.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_5.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_6.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_7.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_8.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_male_9.webp") as number,
  ],
  FEMALE: [
    require("../../../../assets/bodyfat/bodyfat_female_1.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_2.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_3.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_4.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_5.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_6.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_7.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_8.webp") as number,
    require("../../../../assets/bodyfat/bodyfat_female_9.webp") as number,
  ],
};
