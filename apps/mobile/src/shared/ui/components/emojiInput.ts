/** Только эмодзи: есть пиктограмма, нет букв и цифр, не длиннее 8 кодовых точек (как в хранилище). */
export function emojiFromInput(text: string): string | null {
  const value = text.trim();
  if (value === "" || Array.from(value).length > 8) return null;
  if (!/\p{Extended_Pictographic}/u.test(value) || /[\p{L}\p{N}]/u.test(value)) return null;
  return value;
}
