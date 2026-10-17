import type { ExerciseMedia } from "../domain/ExerciseModel.ts";
import { exerciseImages } from "./exerciseImages.generated.ts";

/** Картинка по пути из источника; нет файла — null (показывается значок). */
export function imageSource(path: string | null): number | null {
  return path === null ? null : exerciseImages[path] ?? null;
}

/** Миниатюра для списка: одна поза или начальное положение. */
export function thumbnailOf(media: ExerciseMedia | null): number | null {
  return media === null ? null : imageSource(media.main ?? media.start);
}

/** Позы для карточки: начало и пик либо одна поза. */
export function posesOf(media: ExerciseMedia | null): readonly Readonly<{ label: string; source: number }>[] {
  if (media === null) return [];
  const poses = media.main !== null ? [{ label: "Положение", path: media.main }]
    : [{ label: "Начало", path: media.start }, { label: "Пик", path: media.peak }];
  return poses.flatMap((pose) => {
    const source = imageSource(pose.path);
    return source === null ? [] : [{ label: pose.label, source }];
  });
}
