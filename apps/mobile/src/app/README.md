# AppShell

`bootstrap/`, `navigation/` и `composition/`: готовность приложения, маршруты
trainer-only, темы, обработка app-level ошибок и сборка публичных API.
AppShell не владеет бизнес-фактами, SQL или логикой соседних фич.

`App.tsx` выбирает `createDevRuntime()` (`__DEV__`) или `createProductionRuntime()`;
оба отдают `ApplicationBootGate` зависимости загрузки и сервисы, собранные в
`composition/createServices.ts` (composition root).

`bootstrap/BootCoordinator.ts` — критический boot contract: APP_READY production UI
запрещён до реальной готовности БД и темы.
