# R04: восстановление поддерживаемых черновиков конструкторов

2026-10-25, база `a3120c9`. Входы: все app_settings в admitted snapshot, физические
Plans rows/aliases, явные client/catalog IDs, исходные set segments и immutable
importedAt. Зависимости: Plans/Exercise staging, строгий mappings reader, Settings,
app composition, ordinary constructors/3.x snapshot engine. R04→R03, Product
§§48.5.7,49–50,53–56 / INT-03–12. Private synthetic/finalizable:false; production
DDL/migration/overlay/signing/release gates OPEN. Реальные БД/телефон не открывались.

## Проверенные источники 2.0

Pinned e116b42e95f70a5a5e563420ab25394944c59ffd:

- [draft storage keys](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/settings/trainingBuilderDraftStorage.ts)
  и [Settings getter](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/settings/data/AppSettingsRepository.ts):
  scoped v2 key, envelope и fallback на одиночный legacy slot только при отсутствии
  scoped строки. Невалидный scoped payload не разрешает молча выбрать старый slot.
- [Simple draft](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/simpleProgramDraft.ts)
  и [Periodized draft](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/periodizedProgramDraft.ts):
  shape, недели, editing index, participants и незавершённые copy actions.
- [Exercise/set draft serialization](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/exerciseDraftSetLogs.ts):
  физический exercise key, historyOriginId, planned/actual separation. При
  сохранении builder repRange перекрывает reps неразминочных подходов; сохранённый
  plannedWeight подхода имеет приоритет над exercise default. В импорт не копируются
  старые rounding/default normalizers.
- [Simple loader](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/saveSimpleProgram.ts)
  использует физические workout IDs; [Library repository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/ProgramLibraryRepository.ts)
  даёт ревизию, от которой начиналась правка.

## Изменение

Plans получает явно включаемый builder source, захватывает его до await и пишет
в существующую training_builder_drafts в общей транзакции. Production DDL и новые
private таблицы не добавлены. Полный candidate остаётся из 82 таблиц.

Поддержаны новые Simple/Periodized и правки существующих Simple/mesocycle, когда
доказаны source owner, scope, каталог и текущая базовая ревизия. Для правки старой
страницы требуется совпадение envelope.baseRevision с явным library.revision;
неизвестная/устаревшая ревизия не превращается в текущую по предположению.
Связь клиента и программы берётся из ID/aliases; названия и числовые значения
не используются как доказательство идентичности.

Native Simple envelope содержит draft и исходную преобразованную base. Для
mesocycle сохраняется baseWeeks. Это позволяет обычному 3.x rebase работать после
последующих изменений программы. Существующие entity IDs/родство, rest/instruction,
superset и явно объявленные plan slots сохраняются по проверенным source keys.
Новые сущности получают настоящие UUID в обычном Plans ledger; IDs назначаются
после recoverable parsing, поэтому collision/allocator errors не скрываются как
ошибка JSON. Нет placeholder ID и повторного преобразования с подставленными ID.

Переносится порядок, planned metrics с точными kg→grams/ranges, week types,
editing index и явно заданные участники. Черновик новой Расширенной программы не
получает выдуманное название книги или дату старта: не заполненные в 2.0 поля
остаются пустыми для дальнейшего ввода. Пустые недели не заполняются автоматически.

Actual значения внутри importedSets должны совпасть с конкретной физической
строкой того же exercise/client и её segments/metadata. Они не становятся новым
performed fact. Неподтверждённые факты, warmup, незавершённые copy actions,
непредставимое/неполное число подходов и другие неподдерживаемые формы остаются
raw review. Пустой setCount не заменяется нулём или выдуманным числом подходов.
Произвольные неизвестные поля/типы не пропускаются в нативный черновик молча.

Оба source slot сохраняют отдельное представление. Доказанный scoped slot имеет
приоритет; legacy помечается SHADOWED с причиной, без timestamp pick-last. Разные
scope независимы; конфликт native destination остаётся review, не overwrite.
Ошибки и review reasons содержат фиксированные коды, без исходного текста.

Plans владеет также проверкой обоих native draft tables. Строгий reader требует
builder-enabled mode, проверяет таблицы/ID/source aliases и не ослабляет guards
остальных таблиц. Source receipt физических Plans сохраняет прежний точный
контракт для Execution; builder source/raw representations проверяются в target
receipt. Settings только делегирует эти keys владельцу Plans и сохраняет raw rows.
App composition и независимая ручная цепочка включают одинаковый mode/reader.
Прежний candidate не обновляется на месте; несовместимый mode отклоняется до WAL.

## Доказательства

Новые tests: `scripts/r04-builder-drafts.test.ts`. Синтетический admitted источник
содержит новые и редактируемые Simple/Periodized drafts, явные source revisions,
imported values с proven source fact IDs, два клиента и ordinary catalog IDs.
Native recovery rows создаются без публикации новых программ; число фактов остаётся6.

Проверены scoped precedence/invalid scoped/shadow retention, stale base/catalog/
missing owner/foreign ID/duplicate identity/invalid precision/pending facts/actions,
native base envelopes, stable IDs, supersets/declared slots/rest/instruction,
каждый затронутый checkpoint rollback/retry, native INSERT failure, source/target
drift, allocation collision вне JSON catch, mode/before-WAL guard и source SHA.

Actual Expo file/job/SQLite adapters через SDK mocks: start/resume в fresh Workers
без selected-source доступа и allocator на replay. Дополнительно actual host Worker
termination перед commit откатывает native drafts; fresh resume и replay оставляют
четыре черновика и прежние шесть фактов. Это не Android или power-loss proof.

Native client/Plans/draft rows помещены в полную синтетическую 3.x schema и проходят
actual createSqliteBackup/prepareBackupForRestore. Fresh Worker с активным запретом
legacy-import/shared migration/scripts-r04 использует DevTrainingPlansRepository:
читает новые/старые формы, редактирует recovery, сохраняет новую Simple программу
и правку существующей. Base, members, editing index и пустая неделя сохраняются.
Это проверка штатного storage API; rendering, каталог custom exercises, полный
Execution/provenance/review backup и пользовательский cutover этим не доказаны.

В ходе этапа прошли 36/36 targeted и 596/596 owner/dependency profile. После
добавления проверки superset/declared-slot IDs и последних metadata guards
финальные 13/13 новых tests PASS. Root/mobile TypeScript, scoped lint,
source baseline73/arch614, secrets и staged diff PASS. Общий profile
этой последней редакции целиком повторно не запускался. Foundation/bundle/APK/
Hermes runtime/Android не запускались; новых зависимостей нет.

## Остаётся

Рабочий review/recovery для неподдерживаемых и неполных форм, permanent custom
catalog/Execution/provenance модели, остальная coverage/preferences/lineage,
production admission, UI/cutover, полный backup/removal всех imported данных,
Android interruption/retry/low disk/concurrency/GC/power loss и release proof.
Goal ACTIVE, не100%. UI/темы не полировались.
