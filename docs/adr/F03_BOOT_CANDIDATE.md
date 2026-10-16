# F03 — кандидат безопасного boot gate

**Статус 2026-10-15: PARTIAL / NOT DONE.** Production boot и схема SQLite
не подключены. Dev-only прототип теперь использует gate в `App.tsx`.

## Входы и ограничения

- Backlog F03: `deps=F01,R07`, `ui_gate=shell`; Product §2 и Feature 01.
- Критическая последовательность: локальный trainer workspace → готовность
  БД/миграций → базовые preference/theme → navigator. Пока БД не готова,
  частично рабочий UI запрещён; fatal ошибка даёт Retry без очистки данных.
- Notification/backup/release фоновые сервисы запускаются после APP_READY и
  не блокируют список клиентов. F01 native smoke и F04/D01 schema gates
  открыты, поэтому текущий модуль — контракт с будущими адаптерами.

## Реализовано и проверено

`apps/mobile/src/app/bootstrap/BootCoordinator.ts` задаёт типизированные
`BOOT_PENDING`, `DB_READY`, `APP_READY`, `BOOT_FAILED` и коды отказа.
`APP_READY` публикуется только после `prepareWorkspace`, `openDatabase`,
`loadThemePreference` и безопасного `resolvePalette`. Одновременные
`start()`/reentrant observer не запускают две попытки. `retry()` после
ошибки не имеет операции удаления данных. Фоновые сбои сообщаются отдельным
санитизированным кодом и не меняют `APP_READY`.

`boot:test` — 3/3 PASS: порядок критических этапов, DB gate, retry,
fallback старой темы, независимость фонового отказа и наблюдателей.
`lint`, `typecheck`, `arch:check` проходят. Ошибки не выводят содержимое
исключений, ID клиентов или персональные данные.

Новый dev-only проход использует отдельный файл `fitcoach_f03_dev_gate.db` и
синтетический workspace. `DevBootDependencies.ts` применяет только тестовую
миграцию `dev_boot_marker`, проверяет историю миграции, FK/integrity и закрывает
соединение до показа `PrototypeShell`. На ошибке dev-экран показывает общий
текст и Retry, не удаляет БД. SQLite-адаптер живёт только в composition root;
презентационный экран получает координатор, не SQL handle. Три новых
in-memory SQLite теста подтверждают порядок, отказ при checksum drift и retry
после недоступной БД. `APP_READY` в этом проходе означает **только готовность
dev-прототипа**, не разрешение записи данных клиентов.

После изменений прошли общий foundation suite 69/69, `typecheck`, `lint`,
`arch:check`, `source:verify`, `secrets:check` и Android JavaScript bundle.
На подключённом Android Expo Go уже держал dev-проект открытым; Metro на `8083`
отвечал, USB reverse был активен, а UI hierarchy показывала экран «Клиенты»
без видимого fatal-экрана. После `force-stop` Expo Go и повторного открытия
dev-ссылки UI снова дошёл до вкладок прототипа. Первый intent после остановки
не остался на переднем плане; повторный intent открыл проект. Это ограниченный
Expo Go cold-start smoke, но не process-death/production smoke и не проверка
сохранности реальных данных. Временные UI dumps с телефона удалены.

Ещё два синтетических F03-теста проверяют повторное открытие файловой SQLite
без повторного применения миграции и отказ при пропавшей таблице-маркере даже
при корректной записи в истории миграций. Актуальный `boot:dev:test` — 5/5.

## Открыто до F03 acceptance

- Нет production `prepareWorkspace/openDatabase/loadThemePreference`
  adapters, реальной проверки миграции и Settings repository.
- Dev-only `BootGate` loading/fatal/retry есть; утверждённого production
  shell/navigator и Android warm/process-death тестов всё ещё нет. Expo Go
  cold-start smoke не заменяет native Debug/Release acceptance.
  Тестовая база не выдаётся за `APP_READY` бизнес-приложения.
- TypeScript-контракт адаптера сам по себе не доказывает, что реализация
  действительно ожидает SQLite integrity и миграции до resolve. Это
  проверяется после F04/D01 и native build gate.
