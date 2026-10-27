# R04 — отдельные Notes, Manual Tags и Safety review при переносе 2.0

Дата: 2026-10-23; база кода 593552f. Task R04→R03, D03→R04/R05.
Вход: Client cards/profile и Q history из read-only build120 e116b42, стабильные
client IDs, явный job.createdAt. Product §§10.15,20.2,22.2,23–27,46.6/46.19,
48.5.7,53–56. Migration/overlay/signing/release gates OPEN. Частный synthetic
staging rehearsal; новая production DDL и реальные пользовательские файлы не
затрагивались. Продолжение [композиции анкет](R04_QUESTIONNAIRE_STAGING.md).

## Модель владельца

В clients/domain появился ClientWorkDataModel, доступный через public port модуля.
Это typed domain model, не готовый runtime repository. Поздний Product22.2
требует отдельные TrainerNote, TrainerTag и ClientTagAssignment. Старый reference
SQL client_work_data с JSON blob не является реализацией этих требований.

| Исходник | Записанный результат в R04 стенде |
|---|---|
| trainerNotes | Одна отдельная импортированная TrainerNote с persisted UUID, client/workspace, точным body, pinned=false и LEGACY_IMPORT context |
| trainerTags | Общий workspace TrainerTag и отдельные ClientTagAssignment; несколько клиентов используют одну сущность |
| diagnoses/injuries/pain/hardMovements | Исходные ответы анкеты плюс отдельные PENDING_REVIEW записи, без ACTIVE limitations |
| unwantedLoad | Точный текст в PENDING_REVIEW, без автоматического медицинского/операционного вывода |
| Пустая заметка/нет тегов/нет review sources | Никаких фиктивных Notes/Tags/Reviews; raw source остаётся в receipt |

Дата исходной заметки неизвестна. createdAt=updatedAt новой импортированной Note
равны явному времени переноса, а provenance прямо содержит
IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN и известный clients.updated_at. Не выдаём
создание/изменение карточки за точное время создания заметки. Body не обрезается,
его пробелы/переносы строк сохраняются. Создание нескольких мыслей из текста или
извлечение напоминаний/целей/ограничений по догадке не выполняется.

Safety review — самостоятельный импортный объект, **не** ACTIVE limitation, auto
tag или roster indicator. По Product20.2 исторический диагноз не равен актуальному
рабочему ограничению. Дальнейшее подтверждение тренером и runtime review UI ещё
не подключены. Архивные клиенты сохраняют свои записи; общий тег не архивируется
из-за lifecycle одного клиента.

## Имена тегов и идентичность

Выбрана явная реализационная политика NFC_WHITESPACE_RU_CASE_V1: Unicode NFC,
trim, последовательности whitespace→один пробел, lowercase ru-RU для ключа.
Это не дополнительное утверждение Product/DDL gate. Она версионирована в receipt;
будущая смена политики требует отдельного решения и обработки существующих тегов.
ё/е, разные алфавиты, диакритика и разная пунктуация не подменяются. Пустые или
содержащие оставшиеся control/format characters имена блокируют всю операцию.

Все исходные подписи и позиции сохраняются в provenance. Presentation name
детерминированно выбирается среди нормализованных исходных написаний, а не по
порядку чтения clients. UUID тега резервируется отдельно от имени. В runtime
rename должен менять имя сохранённой сущности, сохраняя ID/назначения; сам runtime
rename этот срез не реализует. Цвет отсутствует, lifecycle новой сущности ACTIVE.
Строка, похожая на системный тег, остаётся ручным тегом и не становится auto truth.

## Транзакция и граница DDL

Явный режим clientIdentityRehearsal с profiles:true, questionnaires:true,
workData:true; отдельная persisted binding WORK_DATA_REHEARSAL_V1.
Метод stageClientWorkData соединяет карты Client IDs/cards, Q history/profile
и normalized work records в одной BEGIN IMMEDIATE. Внутренний callback записи
не выдаётся публичному вызывающему коду. Старые rehearsal-файлы не пересобираются
и не принимаются новым режимом. Q-таблицы могут отсутствовать полностью (null).

Частные r04_work_notes/tags/assignments/reviews/ids/receipt имеют PK/unique/CHECK,
workspace-aware client/tag FK. Это **не production migrations**. Persisted UUID
проверяются на коллизии между clients и всеми work entities. Target-shaped rows,
source→target IDs, normalization policy, точные исходники и target manifest
сверяются перед commit. Reopen/reordered retry не создаёт ID/строк/новых дат,
source/target drift не затирает существующие данные. Ошибка откатывает вместе
карточки, ID maps, Q и все work rows. Общие FK/integrity проверяются до commit.

## Исправление health visibility

Сверка с Product10.15 выявила лишний барьер прежнего среза: сочетание
healthCleared=true с заполненными health details блокировало projection, поскольку
правило отображения прятало эти ответы. Теперь isFieldVisible оставляет заполненные
system diagnoses/injuries/surgeries/pain видимыми при старом clearance rule, включая
существующие опубликованные схемы. Explicit hidden/retired/hidden section и custom
conditions сохраняют свою семантику. Пустые подробности могут оставаться скрытыми.

Оба исходных значения переносятся без изменения галочки или медицинского вывода;
R04_PROFILE_CLEARANCE_CONFLICT больше не нужен. Новая default schema использует
формулировку «Нет известных противопоказаний». SQL/immutable historical schemas
ради этого не переписываются. Это уточнение заменяет прежние ограничения в
R04_CLIENT_PROFILE_STAGING.md о blocking visibility conflict.

## Фактическая проверка

- `npm run r04:work-data:test`: **105/105**, включая 15 новых work-data tests,
  профиль/identity/cards/custom Q зависимости и questionnaire store/visibility.
- Реальные SQLite rows: две заметки, три общих тега, четыре назначения, пять
  pending reviews, исходные custom answers и active/archived clients в одной DB.
- Семь injected failure checkpoints, включая все четыре work table boundaries,
  откатывают всё; повтор проходит. Это host exceptions, не Android process death.
- Read-only synthetic source file SHA до/после совпадает; target reopen/reordered
  retry byte-identical. Edited Notes/Tags/assignments/reviews/ID drift отвергаются.
- Доказаны FK rejection для чужого workspace/orphan tag, allocator collision,
  caller mutation, raw vs stale derived object, policy/исходные labels и unknown
  note time. Положительный clearance не теряет health intake и не создаёт ACTIVE.
- Root/mobile typecheck, changed-file ESLint, source/arch506/secrets/diff. Новые
  тесты включены в r04/foundation; полный foundation/APK/bundle не запускались.
  Application composition, production SQL и UI этого владельца не подключались.

## Остаток общей цели

Результат по-прежнему finalizable:false: модель/запись проверены в R04, но runtime
ClientWorkData repository/production migration, commands/review flow/reads и
участие в backup/deletion manifest должны быть подключены при соответствующем
gate. Наличие частных r04_* таблиц не превращает DB в fitcoach_v3.db.

Далее — перенос каталога упражнений в owner-shaped staging (legacy LOAD_REPS,
без угадывания оборудования/мышц), остальные владельцы/IDs/provenance/full parity,
полный staging и runtime2.0 Restore/JSON v1/v2, interrupted retry/Android. Общая
цель ACTIVE, R04/D03/R05 и технические gates OPEN. UI/темы позже, Excel после
backup/restore. Телефон, установленная2.0 и личные копии не затрагивались.
