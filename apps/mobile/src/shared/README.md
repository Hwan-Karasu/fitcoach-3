# Shared technical layer

Будущие `db/`, `errors/`, `platform/`, `ui/`, `utilities/` содержат только
общие технические механизмы: соединение и транзакции, типизированные ошибки,
Android adapters, UI tokens/примитивы, чистые generic helpers. Доменная логика
остаётся у владельца feature, даже если её используют несколько экранов.

`ui/theme/` уже содержит F07 candidate: generated runtime palette snapshot
из числового UI baseline и чистый resolver. Это не готовая Settings feature,
не сохранение предпочтения и не утверждённый screen design.

`db/` содержит F04 candidate: внутренний SQL-порт, очередь writer, проверяемое
открытие Expo SQLite и общий runner миграций. Он пока не подключён к boot и не
содержит production DDL или бизнес-репозиториев; UI не импортирует `db/`.
