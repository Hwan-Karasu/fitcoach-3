/**
 * Стиль «Зефирка» (UI-OWN-048, `zefirka-package/tokens.json`): радиусы, тени и зона нажатия —
 * общие для всего приложения. Темы меняют только цвета (палитра), стиль от темы не зависит.
 */
export const radius = { sm: 10, md: 14, lg: 18, xl: 20, xxl: 22, pill: 20 } as const;

/** Решение владельца 2026-10-19: кнопки и поля — ровно 44 (видимый размер и зона нажатия). */
export const TOUCH_TARGET = 44;

/** Тени макета (цвет — тёплый текст «Зефирки» с прозрачностью); `boxShadow` RN, без `elevation`. */
export const shadow = {
  card: { boxShadow: "0 1px 2px rgba(31,26,20,0.06)" },
  /** Неактивные пилюли и вкладки: белое на белом читается только по тени и рамке. */
  chip: { boxShadow: "0 1px 3px rgba(31,26,20,0.20)" },
  control: { boxShadow: "0 1px 2px rgba(31,26,20,0.08)" },
  floating: { boxShadow: "0 6px 24px rgba(31,26,20,0.10)" },
  fab: { boxShadow: "0 8px 20px rgba(122,66,16,0.35)" },
} as const;
