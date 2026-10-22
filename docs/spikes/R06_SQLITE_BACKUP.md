# R06 — самостоятельный SQLite .atbackup, host-прототип

2026-10-22. **HOST VERIFIED / NATIVE AND MEDIA GATES OPEN.**

Task R06, входы/зависимости: R03, текущая D01 identity и owner catalogs,
Product §§46.3, 46.12, 46.20, Feature Spec 18 BU-01/02/03. Production DDL,
реальные базы и runtime не меняются. Формат — обычный незашифрованный SQLite,
не ZIP и не собственный бинарный контейнер. Это технический кандидат, пока
не подключённый к приложению и не прошедший Android/SAF.

## Создание

`scripts/r06/SqliteBackup.ts` использует SQLite backup API, включая committed
страницы WAL, а не файловое копирование открытого `.db`. Только в новом private
snapshot добавляются `at_backup_schema_migrations` и `at_backup_manifest`.
Исходный файл/owner ledgers не меняются. Format version 3 отличает кандидат от
legacy 2.0 format 1; это версия прототипа формата, не версия приложения.

Manifest: UUID копии, время, product/workspace, format и content SHA-256.
Content digest включает SQL definitions и типизированные значения всех строк
канонических таблиц (включая soft-deleted/history), их multiplicity и owner
ledgers. Обход построчный; вся БД не загружается в JS память. int64 читается как
BigInt; BLOB/text/null/real различаются. Сортировка с BINARY, без locale/rowid.
Снимочные metadata-таблицы не входят в собственный content checksum.

Перед публикацией private-файл закрывается, синхронизируется и повторно
открывается read-only: собственная identity, catalog с дополнительным snapshot
owner, migrations, integrity/FK, строгий manifest, content checksum.
Host-публикация через exclusive hard link не оставляет полузаписанное публичное
имя и не заменяет существующий backup. Это механизм локальной host-проверки,
не реализация Android SAF. Ротация не выполняется. Все private artifacts при
сбое остаются для recovery/последующей уборки; удачная публикация не становится
ошибкой из-за неудачного удаления private duplicate.

## Восстановление

Источник открывается только read-only. После проверки отдельный SQLite backup
создаёт private staging. Snapshot metadata удаляются только из staging одной
транзакцией; штатная production identity и полный content digest проверяются
до commit. После этого кандидат подходит для `GuardedRestore`. Файл `.atbackup`
не меняется и пригоден для повторной попытки; replay/confirmation относится к
конкретной операции восстановления, а не к записи доменных фактов.

Снимок с неизвестной таблицей/версией/checksum, изменёнными строками, чужой
identity либо незавершённым WAL отвергается. Production opener по-прежнему
отклоняет snapshot с metadata: его нельзя напрямую принять за рабочую базу.
Checksum — защита от повреждения, не криптографическая подпись автора копии.

## Проверки и оставшиеся работы

Синтетический roundtrip создаёт данные через настоящие repositories: клиент,
emoji, два замера, тема, продукт/рецепт, снимок питания, подход 20×10кг. Затем
исходный `.db` удаляется: один `.atbackup` восстанавливает точный логический
digest схемы/строк. Отдельно проверяются committed WAL без изменения source,
цепочка backup→staging→guarded restore, порча manifest/строки/ledger/inventory,
exclusive paths и typed streaming checksum с int64/BLOB/null/дубликатами.

**Фото рецепта реально присутствует в текущем приложении.** Сейчас прототип
обнаруживает `recipes.details_json.photoUri` и не публикует неполный DB-only
backup (`SNAPSHOT_INCOMPLETE_MEDIA`). Нельзя объявлять механизм полностью
готовым, пока байты фото и перенос URI не включены в тот же SQLite `.atbackup`.
Публичный UI не подключён: этот код пока не показывается пользователю.

Открыты также: полная owner-matrix (анкеты, исторические версии программ,
Ledger/Calendar, уведомления, targets), native API/streaming и memory traces,
quiescence/reopen/scheduler, Android process-kill/ENOSPC, SAF publication/read,
автоматическая ротация, пользовательская Return point (§§46.8–46.11) и 2.0
source conversion. Host SAFETY — техническая копия протокола, не готовая
пользовательская точка возврата в общем хранилище.
