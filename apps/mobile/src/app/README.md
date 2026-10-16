# AppShell

Здесь уже есть диагностический `bootstrap/`; затем появятся `navigation/` и
`composition/`: готовность приложения,
маршруты trainer-only, темы, обработка app-level ошибок и сборка публичных API.
AppShell не владеет бизнес-фактами, SQL или логикой соседних фич.

`bootstrap/BootCoordinator.ts` — F03 candidate критического boot contract.
Пока он не подключён к SQLite/Settings adapters и не заменяет диагностический
F01 экран. APP_READY production UI запрещён до реальной готовности БД/темы.

`composition/createDevServices.ts` — F05 candidate явной dev-сборки F04 probe.
Production bindings и реальные публичные feature APIs ещё не созданы.
