# F06 — кандидат подписок и точечной инвалидации

## Входы и границы

- Backlog `F06`: зависимости `F04,F05`; Product §§2.11, 7.15–7.16;
  Architecture ADR-A05; UI gate `none`.
- Источник истины: `../FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`.
- F04/F05 пока частичные. Production schema, owner repositories и loaders ещё
  не утверждены (D01/D04/C01). Код ниже не объявляет эти gates закрытыми.

## Реализовано

- `QueryRegistry` различает тип, workspace, client, параметры и localDate.
  Зависимости задаются domain, scope и необязательными entity IDs.
- Один post-commit batch обновляет каждый пересекающийся запрос один раз;
  у остальных snapshot identity и revision не меняются.
- Generation guard отбрасывает поздний ответ старого запроса. При refresh
  остаётся прежний валидный snapshot; ошибки чтения не подменяют его нулём.
- `useQuerySnapshot` даёт экрану per-query подписку через
  `useSyncExternalStore`, без глобального remount.
- `writeWithChanges` вызывает publisher после успешного завершения
  `WriterCoordinator.write`, а при отказе транзакции не публикует изменения.

## Evidence и открытое

`npm run readmodels:test`, `npm run test:foundation` (30/30), `npm run
typecheck`, `npm run lint`, `npm run arch:check`, Android JS bundle,
`npm run source:verify` и `npm run secrets:check` прошли локально 2026-10-15.
Тесты включают client A/B, другой workspace, entity ID, широкий manifest,
batched refresh, stale async response, сохранение snapshot и post-commit barrier.

F06 остаётся **PARTIAL / NOT DONE**: нет production loaders/владельцев данных,
подключения экранов к реальным DTO, Android runtime/performance evidence и
restore-lifecycle проверки. Нельзя считать этот слой готовой карточкой клиента
или завершённой схемой БД.
