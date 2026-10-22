# R06 — фото рецептов внутри SQLite .atbackup

2026-10-22. **HOST VERIFIED; ANDROID/DECODER/STORAGE GATES OPEN.**

Task R06: текущие D01 catalogs, существующий RecipeEditor/LocalImageStore,
Product §§46.3, 46.20; Feature Spec 18 BU-01/02/03. Это поддержка уже реализованных
фотографий рецептов, не добавление фото-аватаров/прогресса/документов. Поиск
LocalImageStore/photoUri в mobile source подтвердил единственный файловый owner.
Production DDL и live backup UI не меняются.

## Копия

Snapshot owner получил **forward migration 2**, migration 1 не изменена.
Дополнительные таблицы существуют только в backup-файле:

- at_backup_media: PK SHA-256 исходного URI, UNIQUE source_uri (1–2000), MIME,
  положительная целая длина, SHA-256 содержимого, количество блоков;
- at_backup_media_chunks: PK(media_id, position), FK→media с RESTRICT, BLOB
  длиной 1..262144, неотрицательная целая позиция.

Manifest formatVersion 3 дополнен media version 1: entries/bytes/descriptor SHA.
Старый metadata-only prototype с owner ledger 1 продолжает читаться без
пересборки/изменения source. Ledger 2 требует media summary, даже при нуле фото.
Таблицы и весь контент снимка создаются в SQLite-транзакции до публикации.

Берём все рецепты, включая архивные. Общий URI включается один раз; покрытие
ссылок должно быть точным, без пропущенных/посторонних объектов. realpath и
containment ограничивают чтение каталогом LocalImageStore, не путём из чужого
backup. Внешние/remote URI, traversal, symlink за пределы, каталог, отсутствующий
или пустой файл блокируют публикацию. MIME определяется по сигнатуре PNG/JPEG/
WebP/HEIC; расширение исходного имени не считается доказательством типа.

Чтение по 256 КиБ, без целого файла в JS памяти. Перед/после чтения сравниваются
size/mtime/ctime. Блоки, descriptor и manifest публикуются вместе. На чтении
snapshot проверяются layout/типы/длины **до** загрузки BLOB, contiguous positions,
количество/сумма, SHA содержимого и descriptor digest. Проверка не открывает
старые media URI, поэтому отдельный `.atbackup` не зависит от прежней установки.

## Подготовка восстановления

После проверки копии байты извлекаются в **новые** private filenames с UUID
операции и asset ID; имена и пути из исходной базы не используются как target.
Запись идёт в exclusive partial, затем fsync/read-back SHA и exclusive publish.
Существующий файл не затирается: retry с тем же restoreId допускает только
полностью совпадающий файл. Старые изображения текущей базы не удаляются.

Только после готовности изображений staging одной транзакцией убирает snapshot
metadata и меняет recipes.details_json.photoUri. ID, revision, timestamps,
архивный статус, другие поля и unknown JSON сохраняются. Полная логическая
parity сравнивается с source: только проверенное переездом URI поле
нормализуется к **точным старым JSON bytes**, остальные строки/SQL хешируются
обычно. Успех выдаётся после normal production identity/FK/integrity проверки.
GuardedRestore фиксирует SHA уже подготовленного staging, включая новые URI.

Сбой до смены live оставляет только неиспользуемые private staging/images.
Ни исходная `.atbackup`, ни live DB/изображения не меняются. Новая попытка
использует новый staging/restoreId; неполный старый кандидат не принимается
за рабочую базу. Уборка orphan files и native durability — отдельная интеграция.

## Доказательство

`scripts/r06-backup-media.test.ts`: настоящий SQLite, изображение из нескольких
блоков, shared/archived refs, удаление source DB и media, восстановление только
из `.atbackup`, точные байты, перенос URI и parity остальных полей; missing/
outside/traversal/symlink/non-image; порча байтов/layout/manifest/coverage;
совместимость metadata-only prototype. Три отдельных процесса получают SIGKILL
при INSERT media chunk, записи partial image и публикации image: live/source
backup не меняются, следующая попытка проходит.

Это проверка на host, не доказательство Android Image decoder, SAF, process
lifecycle или power-loss durability. Native-механизм должен использовать тот
же format/parity contract и пройти device roundtrip до подключения к UI.
