# F05 — границы модулей и DI (кандидат)

**Статус 2026-10-15: PARTIAL / NOT DONE.** Входы: backlog F05,
`deps=S02,F02`, Architecture §4.2/ADR-A03, Product §§1–2. S02 и F02
остаются частичными/на рассмотрении; production data и UI gates открыты.

## Реализовано

- Статический import graph теперь запрещает обход `public.ts` из AppShell,
  workflows и read-models; application-слой фичи не импортирует concrete data
  или presentation, data не импортирует application/presentation, а публичный
  barrel не выдаёт database internals.
- В dev-сценарии F04 создан явный composition root: экран получает только
  функцию запуска проверки, а сервис получает фабрику подключения. Это пример
  инъекции, не production service locator и не бизнес-API.
- `arch:test` 10/10, `arch:check` на 68 TypeScript-файлах, typecheck, lint,
  Android JS bundle и source verify прошли. На Android Expo Go повторная
  F04-диагностика после DI-рефакторинга показала 5/5.

## Открыто

- Публичные query/command-контракты и реальные owner-scoped repositories
  добавляются с C01/C03 и другими feature tasks после D01/D04; не создавать
  фиктивные сервисы ради закрытия F05.
- Нет production composition root, интеграционных проверок межмодульных
  транзакций и удалённого CI evidence. Статический checker не доказывает
  семантику операций и права доступа в runtime.
