/**
 * NUT-019: какие файлы фото рецепта больше никому не нужны.
 * `picked` — копии, созданные в этом сеансе редактора; `previous` — фото, уже сохранённое в рецепте до открытия;
 * `current` — фото в форме на момент выхода; `saved` — рецепт успешно записан.
 * Сохранённое ранее фото при отмене не трогается; при записи удаляется только если заменено или убрано.
 */
export function photosToDiscard(input: Readonly<{ picked: readonly string[]; previous: string | null; current: string | null; saved: boolean }>): readonly string[] {
  const discard = new Set(input.picked);
  if (input.saved) {
    if (input.previous !== null) discard.add(input.previous);
    if (input.current !== null) discard.delete(input.current);
  } else if (input.previous !== null) {
    discard.delete(input.previous);
  }
  return [...discard];
}
