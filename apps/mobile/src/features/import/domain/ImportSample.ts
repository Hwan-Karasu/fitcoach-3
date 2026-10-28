/**
 * Образец для импорта (скачивается из приложения). Макет — как у файла, который даёт 2.0: один лист — один цикл; строка названия,
 * строка «Упражнение | Подход | Неделя N» (каждая неделя — пять объединённых столбцов), строка подписей «План | Пред. | Повт. | Кг | Дата»,
 * тренировки — строки-разделители, упражнения — подходы строками. Импорт читает такую матрицу без настройки (`flattenLegacyMatrix`).
 */
export const IMPORT_SAMPLE_FILENAME = "Образец для импорта.xlsx";
export const IMPORT_SAMPLE_SHEET = "Гипертрофия";
export const IMPORT_SAMPLE_LABELS = ["План", "Пред.", "Повт.", "Кг", "Дата"] as const;
const WEEKS = 3;
const WIDTH = 2 + WEEKS * IMPORT_SAMPLE_LABELS.length;

type Cell = string | number;
type WeekRow = Readonly<{ plan: string; previous?: string; reps?: number; load?: number; date?: string }>;
interface SampleExercise { readonly name: string; readonly sets: readonly (readonly [WeekRow, WeekRow, WeekRow])[] }
interface SampleWorkout { readonly title: string; readonly exercises: readonly SampleExercise[] }

const sample: readonly SampleWorkout[] = [
  { title: "Тренировка А", exercises: [
    { name: "Жим штанги лёжа", sets: [
      [{ plan: "8–10 × 60 кг", reps: 10, load: 60, date: "2026-10-05" }, { plan: "8–10 × 62.5 кг", previous: "10 × 60", reps: 10, load: 62.5, date: "2026-10-12" }, { plan: "8–10 × 65 кг", previous: "10 × 62.5" }],
      [{ plan: "8–10 × 60 кг", reps: 9, load: 60, date: "2026-10-05" }, { plan: "8–10 × 62.5 кг", previous: "9 × 60", reps: 9, load: 62.5, date: "2026-10-12" }, { plan: "8–10 × 65 кг", previous: "9 × 62.5" }],
      [{ plan: "8–10 × 60 кг", reps: 8, load: 60, date: "2026-10-05" }, { plan: "8–10 × 62.5 кг", previous: "8 × 60", reps: 8, load: 62.5, date: "2026-10-12" }, { plan: "8–10 × 65 кг", previous: "8 × 62.5" }]] },
    { name: "Тяга верхнего блока", sets: [
      [{ plan: "10–12 × 45 кг", reps: 12, load: 45, date: "2026-10-05" }, { plan: "10–12 × 47.5 кг", previous: "12 × 45", reps: 12, load: 47.5, date: "2026-10-12" }, { plan: "10–12 × 50 кг", previous: "12 × 47.5" }],
      [{ plan: "10–12 × 45 кг", reps: 11, load: 45, date: "2026-10-05" }, { plan: "10–12 × 47.5 кг", previous: "11 × 45", reps: 12, load: 47.5, date: "2026-10-12" }, { plan: "10–12 × 50 кг", previous: "12 × 47.5" }]] }] },
  { title: "Тренировка Б", exercises: [
    { name: "Приседания со штангой", sets: [
      [{ plan: "6–8 × 80 кг", reps: 8, load: 80, date: "2026-10-07" }, { plan: "6–8 × 82.5 кг", previous: "8 × 80", reps: 8, load: 82.5, date: "2026-10-14" }, { plan: "6–8 × 85 кг", previous: "8 × 82.5" }],
      [{ plan: "6–8 × 80 кг", reps: 8, load: 80, date: "2026-10-07" }, { plan: "6–8 × 82.5 кг", previous: "8 × 80", reps: 8, load: 82.5, date: "2026-10-14" }, { plan: "6–8 × 85 кг", previous: "8 × 82.5" }],
      [{ plan: "6–8 × 80 кг", reps: 7, load: 80, date: "2026-10-07" }, { plan: "6–8 × 82.5 кг", previous: "7 × 80", reps: 8, load: 82.5, date: "2026-10-14" }, { plan: "6–8 × 85 кг", previous: "8 × 82.5" }]] }] },
];

/** Лист образца: строки и объединённые ячейки (строка 0 — название, строка 1 — недели, строка 2 — подписи, далее тренировки). */
export function importSampleSheet(): Readonly<{ rows: Cell[][]; merges: readonly { r: number; c0: number; c1: number }[] }> {
  const blank = (): Cell[] => Array.from({ length: WIDTH }, () => "");
  const rows: Cell[][] = [blank(), blank(), blank()];
  const merges: { r: number; c0: number; c1: number }[] = [{ r: 0, c0: 0, c1: WIDTH - 1 }];
  rows[0]![0] = "Образец · цикл «Гипертрофия»";
  rows[1]![0] = "Упражнение"; rows[1]![1] = "Подход";
  for (let week = 0; week < WEEKS; week++) {
    const column = 2 + week * IMPORT_SAMPLE_LABELS.length;
    rows[1]![column] = `Неделя ${week + 1}`;
    merges.push({ r: 1, c0: column, c1: column + IMPORT_SAMPLE_LABELS.length - 1 });
    IMPORT_SAMPLE_LABELS.forEach((label, at) => { rows[2]![column + at] = label; });
  }
  for (const workout of sample) {
    const title = blank(); title[0] = workout.title;
    merges.push({ r: rows.length, c0: 0, c1: WIDTH - 1 });
    rows.push(title);
    for (const exercise of workout.exercises) {
      exercise.sets.forEach((perWeek, setIndex) => {
        const row = blank();
        if (setIndex === 0) row[0] = exercise.name;
        row[1] = setIndex + 1;
        perWeek.forEach((cell: WeekRow, week) => {
          const column = 2 + week * IMPORT_SAMPLE_LABELS.length;
          row[column] = cell.plan; row[column + 1] = cell.previous ?? ""; row[column + 2] = cell.reps ?? ""; row[column + 3] = cell.load ?? ""; row[column + 4] = cell.date ?? "";
        });
        rows.push(row);
      });
    }
  }
  return { rows, merges };
}
