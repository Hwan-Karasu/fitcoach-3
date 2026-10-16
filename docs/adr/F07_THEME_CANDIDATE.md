# F07 — кандидат Theme Catalog 9×3

**Статус 2026-10-15: PARTIAL / NOT DONE.** Нормативный backlog остаётся
`PLANNED`; цветовые значения — `DESIGN BASELINE`, не Android QA sign-off.

## Входы и gates

- Backlog F07: `deps=F01,S02`, `ui_gate=component`, acceptance: девять схем,
  onAccent/focus для каждого акцента, сохранение и переход без потери editor/nav,
  27 combinations tests.
- Product §§55–56 утверждают модель 9×3, но не сертифицируют пиксельные экраны.
  `05-UI-UX/theme-catalog.v1.json` — единственный числовой baseline;
  `UI_FOUNDATIONS.md` задаёт семантические роли и Android-проверки.
- F01 native gate и полный S02 review открыты. Поэтому реализован только
  независимый от UI/БД palette resolver, не экран настройки и не сохранение
  preference.

## Реализовано и проверено

- `theme:generate` переносит в TypeScript runtime-снимок девять тем из
  исходного JSON после проверки schemaVersion/структуры/HEX/ID. Снимок
  `catalog.generated.ts` содержит SHA-256 исходника
  `68c836d685b0dec264c9acbb1492f96cba9906903de1f77854acccd4db977af8`.
  `theme:check` подтверждает, что runtime-снимок совпадает с источником.
  Генерация нужна для автономной сборки мобильного проекта без соседней
  документарной папки; исходный JSON остаётся источником истины.
- `resolvePalette` принимает сохранённые `themeId/accentId` и **явно переданный**
  приложением fallback theme ID. Неизвестный theme ID выбирает этот fallback,
  неизвестный accent ID — default данной темы. Выбор не мутирует preference
  и не касается бизнес-данных. Утверждённая тема по умолчанию не выдумана.
- 27/27 сочетаний проходят типовые проверки токенов; контраст тестируется
  для primary text/surface, onAccentFill/accentFill и focusRing на surface/input.
  `focusRing` пока равен `resolvedInk` акцента; тест подтверждает только эти
  пары, а не все Android состояния. `theme:test`, lint, typecheck,
  `arch:check` проходят.

## Открыто до F07 acceptance

- Нет `Settings repository` и сохранения preference, preview UI или
  перехода темы без потери editor/nav; ни одна тема ещё не показана на Android.
- `accentSubtle`, `scrim`, `onScrim`, Android system bars и прочие производные
  роли не определены численно в JSON и требуют отдельного компонентного
  решения/контрастной проверки. Resolver не притворяется полной библиотекой.
- 27 палитр не равны 27 принятым экранам: goldens, TalkBack, font scale,
  контраст всех состояний и device smoke остаются UI/technical gates.
