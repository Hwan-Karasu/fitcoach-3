# R04: все app_settings и перенос поддерживаемых настроек

2026-10-25, база `8bd28a1`. Входы: весь app_settings из того же admitted pinned
snapshot, существующий Settings baseline, common Node/async write executor,
app candidate composition, durable job runtime и обычный snapshot engine 3.x.
R04→R03, Product §§49–50,53–56 / INT-03–12. Только private synthetic staging,
finalizable:false. Production DDL/migration/overlay/signing/release gates OPEN.

## Почему требовалось изменение

Раньше мобильный source reader читал из app_settings только calendar_planner_settings.
Там же 2.0 хранит пользовательские настройки и незавершённые черновики конструктора.
Их отсутствие в возвращённом snapshot нельзя считать полным переносом.

Проверен pinned исходник e116b42e95f70a5a5e563420ab25394944c59ffd:

- [AppSettingsRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/settings/data/AppSettingsRepository.ts):
  фактические keys/форматы, plaintext light/dark, JSON карточек, default dark,
  SQLite datetime для времени записи и отдельные технические OS/navigation keys.
- [clientCardSettings](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/settings/clientCardSettings.ts):
  metric IDs, старый program→pack, start tabs и флаги навигации.
- [trainingBuilderDraftStorage](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/settings/trainingBuilderDraftStorage.ts):
  старый и v2 scoped draft key; draft payload нельзя выдавать за опубликованный план.

## Реализация

Full import snapshots теперь включают отдельный Settings source с **каждой**
строкой app_settings. Общий read plan проверяет physical shape, cardinality и
unsafe SQL numbers до передачи значений через native bridge. Исторический
profile-only API не менялся. Calendar по-прежнему читает свой planner key.

Владелец Settings предоставляет projection/schema/write/parity для Node и async
исполнителя. Application composition добавляет его последним в общую транзакцию.
Capture raw SQL values, включая копию BLOB, происходит до первого await. Нет
новых зависимостей, production schema changes, fake IDs или отдельного commit
на настройки. Новый immutable mode не обновляет старый candidate файл на месте.

Поддерживаемые значения записываются в обычную settings.appearance:

- light/dark → уже поддерживаемые обычным theme reader aliases polar-teal/
  graphite-teal; отображение существующих aliases не изменяется. При переносе
  карточек без явного theme учитывается документированный default dark в 2.0;
- pack/program → credits, visit → lastTraining; остальные доказанные metric IDs
  сохраняются вместе с порядком, без truncation/дедупликации неизвестных данных;
- home/kbju/training → Home/Nutrition/Training. Старые profile/archive ведут в
  объединённое More по §53.3; исходный выбор сохраняется, отмечено отличие;
- showHealthBadge сохраняется, showBackToClients → showClientListShortcut,
  showNavigationLabels инвертируется в hideNavigationLabels.

Отсутствующие части частично сохранённой карточки получают обычные defaults 3.x
с явной причиной в source ledger. Неподдерживаемые birthday/другие properties
остаются raw review. Это не заявление о полном переносе всех UI preferences.

Каждой исходной строке соответствует source key/account scope, raw SQL row,
disposition, target key и fixed issues в r04_settings_source. BLOB имеет явное
hex-представление, отличное от исходной TEXT строки. Receipt сохраняет null/
наблюдаемый пустой store, все raw rows и проверяемые целевые строки.

Dispositions различают applied/partial review, отдельную обработку Calendar,
review-required settings и сбрасываемое техническое состояние (старые OS timer/
notification IDs, navigation resume и подобное). Неизвестные keys, backup/privacy/
notification preferences, import profiles и builder drafts **не исчезают** и
не объявляются рабочими настройками 3.x: они явно требуют дальнейшего mapping.
Raw retention пока private, не постоянная review модель и не full backup proof.

Невалидный JSON/тип/непредставимое число optional preference не меняет даже часть
карточки: поддерживаемые изменения применяются только после её проверки целиком.
Остальные факты продолжают переноситься, исходное значение и причина остаются.
Duplicate/null setting key и чужой account scope блокируют всю транзакцию.
Target updated_at — момент записи импорта; source timestamp остаётся в raw,
не преобразуется в выдуманную дату фактов. Ошибки не выводят исходные значения.

## Проверки

12 новых tests в r04-settings-stage.test.ts; полный owner/dependency profile
r04:plans:test: **584/584 PASS**. До добавления последних guard cases отдельный
новый набор прошёл 9/9. Root/mobile TypeScript, scoped lint, source73/arch613 PASS.
Secrets/staged diff PASS. Foundation/bundle/APK/Android нет.

Синтетический admitted источник содержит девять setting rows, в том числе оба
draft key, malformed unknown JSON, backup preference, старый OS ID и Calendar key.
Все девять имеют source representation; native preference читает обычный parser.
Проверены sync==async, порядок строк/replay без новых IDs, capture, BLOB,
missing/empty stores, scope/identity/old-mode-before-WAL, invalid optional JSON/
precision без частичной записи, каждый checkpoint/before-commit rollback/retry,
COMMIT acknowledgement loss, schema/INSERT/row-loss/unsafe-SQL failures,
source/native/source-ledger/receipt drift, FK/handles/source SHA.

Application composition тест теперь сравнивает весь набор таблиц, включая
Settings, с ручной цепочкой и проверяет финальный Settings rollback. Для полного
candidate теперь 82 таблицы (ранее 79), без production admission.

Actual Expo file/job/SQLite adapters через SDK mocks и два fresh Workers сохраняют
Settings при start/resume с запретом обращения к selected source/allocator.
Это host evidence, не Android process/power loss.

Отдельно native preference rows помещены в полную синтетическую схему 3.x;
actual createSqliteBackup/prepareBackupForRestore выполняют snapshot roundtrip.
Fresh Worker блокирует импорт legacy-import/shared migration/scripts-r04;
намеренный запрещённый import доказывает активность guard. Обычный
DevSettingsRepository читает восстановленные значения, обычный theme resolver
сохраняет светлый режим, навигацию и metrics. Private source/review receipts
этим тестом **не** копируются в production и не объявляются прошедшими full backup.

## Что остаётся

Рабочее восстановление builder drafts, оставшиеся preferences/table coverage/
lineage, permanent Execution/review/provenance и schema admission, пользовательский
workflow/cutover, полный backup/removal всех imported data, Android kill/retry/
low disk/concurrency/GC/power loss и release proof. UI/темы не полировались.
Goal ACTIVE, не100%.
