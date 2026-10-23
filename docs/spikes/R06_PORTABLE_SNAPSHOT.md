# R06 — общий формат SQLite snapshot для Node и Expo

2026-10-23. R06/D05 остаются открытыми. Входы: D01 identity/owner catalog,
host `.atbackup` и GuardedRestore. Product §§46.3/46.20: один несжатый SQLite,
самодостаточность поддерживаемых медиа, проверка до замены; gates реальной миграции
и overlay не закрываются этим стендом.

## Реализация

`SqliteSnapshotEngine` в backup/data теперь выполняет seal/validation/staging для
обоих окружений. Общими стали manifest parser, замороженный snapshot owner,
типизированный content checksum, media layout/digest/coverage и перенос photoUri.
Host driver оставляет Node SQLite backup API, exclusive reservation и publication;
`ExpoSqliteBackup` использует Expo SQLite backup API. Исходный внешний файл Android
сначала копируется в новый private slot, и только этот slot открывается SQLite.
Файловые adapters проверяют readback до публикации нового изображения.

Snapshot migrations 1/2 не менялись; их исходные checksum закреплены независимыми
golden assertions. Старый metadata-only snapshot остаётся читаемым. Рабочая D01
схема не менялась; default app runtime пока не подключает этот механизм.

## Точность чисел и тесты

Старый Node content hash сохранён как независимый oracle. INTEGER читается как
SQL TEXT и не проходит через неточный JS number; REAL читается исходным double
и кодируется IEEE big endian. Эксперимент выявил потерю знака `-0` при SQLite
printf→Number: этот обход удалён, fixture снова совпадает с Node oracle.

Android Expo SQLite нормализует целые по значению числовые параметры в Long
(`SQLiteModule.kt`, normalizedParam). Поэтому тест одного и того же хранилища
SQLite на двух платформах задаёт типы SQL literals, включая REAL `-0.0`, максимальный
double, subnormal, ±Infinity и точные крайние int64. Отдельный host test доказывает
совпадение этой fixture со старым вариантом и Node oracle. Это не изменение driver
binding в пользовательских командах. Engine копирует канонические строки SQLite
backup API, не пересоздаёт их через JS-числа.

Проверяются также NULL/пустые TEXT/BLOB, дубликаты, NOCASE против BINARY, short reads
фотографии и rollback metadata transaction при изменении исходного изображения.
Ранее существовавшие host corruption/process-kill/roundtrip тесты теперь запускают
этот общий engine; отдельного второго media алгоритма в scripts больше нет.

## Android

[Фактический отчёт](R06_FULL_SNAPSHOT_REPORT.json) сохраняет агрегированные результаты
из ReactNativeJS, без пользовательских данных и device identifiers. Normal run:
**19/19** — scalar oracle, один `.atbackup` с архивным рецептом и фото >512 КиБ,
удаление исходного фото, проверка manifest/полного content hash, создание staging,
сохранность исходной копии, guarded replace, repository reopen без merge,
точные байты и Android image decoder 1×1, revisions/JSON/архив и receipt replay.
В elapsed normal run входит ожидание при dozing устройства; это не замер SLA.

Force-stop после physical swap до COMMITTED: отсутствие процесса подтверждено.
В новом процессе recovery **7/7** — точные прежние bytes/client/SAFETY,
сохранённый rejected, отсутствие merge и повтор без потери последующих записей.
Это подтверждение нового полного формата, отдельно от старого raw-database report.
Итог foundation **939/939**, typecheck/lint/arch/source/secrets/diff checks;
development Android bundle реально запущен на устройстве. Отдельный production
bundle в этом срезе не собирался.

## Что ещё требуется

SAF/Downloads publication, выбор файла/каталога и сохранение прав, переустановка,
native negative/low-storage matrix, full-owner populated device roundtrip,
boot recovery до инициализации приложения, остановка repositories/workflow leases/
scheduler, user confirmation, read-model invalidation, ротация и Return point.
Private операции должны выполняться последовательно одним controller. Expo не даёт
directory fsync — process death не доказывает устойчивость к отключению питания.
Полный перенос всех данных 2.0 в production owners остаётся отдельной частью цели.
