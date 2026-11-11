/** Черновик ячейки ввода: чьё это место, какое значение было сохранено и что показано сейчас. */
export interface InputDraft {
  readonly identity: string;
  readonly saved: string;
  readonly text: string;
  readonly invalid: boolean;
}

/**
 * Согласование черновика с сохранённым значением. Защищается только набранное и ещё не записанное (ячейка в фокусе
 * или с отложенной записью, и текст отличается от сохранённого): чистая ячейка в фокусе принимает новое значение —
 * иначе перенос из «Пред.» не отобразился бы в ячейке, где стоит курсор. Другая ячейка берёт своё значение всегда.
 */
export function reconcileInputDraft(draft: InputDraft, identity: string, saved: string, protectedDraft: boolean): InputDraft {
  // Запись дошла: сохранённое стало равно набранному тексту — «набранного и не записанного» больше нет, черновик догоняет базу.
  // Иначе ячейка, где пользователь печатал и не терял фокус, навсегда оставалась «набранной» и не принимала перенос из «Пред.»
  // (в строке подставлялись только повторы, вес оставался пустым до перезахода).
  if (draft.identity === identity && draft.text === saved && draft.saved !== saved) return { ...draft, saved, invalid: false };
  const typed = draft.identity === identity && draft.text !== draft.saved;
  const reset = draft.identity !== identity || (!(protectedDraft && typed) && draft.saved !== saved);
  return reset ? { identity, saved, text: saved, invalid: false } : draft;
}
