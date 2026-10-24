# R04: мобильные источники клиентов, упражнений и анкет

2026-10-24, база `6bb28b7`. Входы: проверенные host readers/projections
Clients/Card/Profile, ExerciseCatalog, Questionnaire и общий SQLite read plan.
R04 зависит от R03; Product §§48.5.7, 49–50, 53–56; INT-03–12.
Production DDL, реальная миграция, overlay, signing и release gates OPEN.
Только synthetic private source/staging; `finalizable:false`, без UI/телефона.

## Реализация

`LegacyProfileReadPlans` читает полные client/catalog строки и questionnaire
templates/revisions/answers/change sets с xinfo/count/unsafe SQL number guards.
Старые Node readers исполняют тот же план. Порядок строк задаётся SQLite по прежним
ключам, включая workspace/revision/id, а не JS-сортировкой Unicode или именами.
Unknown columns/BLOB, soft deletion, архивные владельцы, NULL и исходные JSON
сохраняются. Частичная анкета, в том числе один change history без остальных
таблиц, не превращается в отсутствие анкеты. View вместо таблицы блокирует чтение.
Полностью отсутствующая анкета остаётся null; существующая пустая — отдельный факт.

Новый внутренний `readLegacyProfileSnapshots` читает этот набор в одной pinned
транзакции. Проверенный файловый entry после обязательного admission теперь
читает все восемь владельцев в том же snapshot и проверяет закрытые bytes/SHA.
Непроверяемый caller-scope в файловый путь не добавлен. Старые low-level API
трёх доменов и training сохраняют свои контракты.

Чистые ClientIdentity/Card/Profile, ExerciseCatalog и Questionnaire projections
перенесены к владельцам: `clients`, `exercises`, `questionnaire` в подпапки
`domain/legacy-import/`. Общие private source contracts/value helpers — в
`shared/migration/LegacyProfileSources.ts` и `LegacyValues.ts`. Импортёр отвечает
за старый файл, владельцы — за преобразование. Правила module boundaries не
ослаблены, public API/UI не расширены. Старые scripts entry points — wrappers;
aggregate summaries остаются host-only, персональные значения в них не добавлены.

Node crypto заменён в questionnaire IDs на уже установленную `@noble/hashes`.
SHA256 вычисляется над тем же JSON UTF8, поэтому существующие стабильные IDs,
semantic epochs и ссылки не меняются. Клиенты и упражнения не объединяются по
имени. Все старые упражнения сохраняют `LOAD_REPS`; неизвестная категория и
отсутствующее оборудование не угадываются. Повторные client IDs теперь
отклоняются непосредственно при identity projection.

Исходные JSON strings сохранены дословно. Этот срез не решает отдельно вопрос
точного представления всех числовых questionnaire JSON-ответов и не доказывает
их постоянную запись/backup в полной конечной модели. Shared source contracts
и `domain/legacy-import/` также должны удаляться вместе с переходным импортёром;
обычные 3.x readers не должны от них зависеть.

## Проверки

8 новых тестов `r04-portable-profile-source.test.ts`:

- mobile/Node кандидаты совпадают; два клиента и два упражнения с одинаковыми
  именами остаются разными, unknown BLOB, raw JSON digits, archived client,
  deleted client/exercise/answer и оригинальные версии не теряются;
- absent/partial questionnaire/change-only/view и отсутствующие поля различаются;
- unsafe SQL revision блокируется до bridge, row loss каждого owner обнаруживается;
- реальный WAL writer одновременно меняет client/catalog/answer; reader видит
  единый прежний snapshot;
- SHA IDs совпадают с Node crypto для Unicode, emoji, combining marks, lone
  surrogate, escaped/control strings и semantic epoch parts;
- isolated worker загружает все чистые projections с запретом любых Node imports;
- mandatory-admitted mobile snapshots идут через реальные projections в общий
  host staging: failure после exercise receipt откатывает клиентов, версии,
  ответы, work data и registry; retry/replay сохраняет IDs и строки без allocator;
  нулевой ответ остаётся нулём, target FK чистые.

Admission и actual Expo file driver SDK fixture дополнены assertions на доставку
трёх новых snapshots до file entry. Synthetic metadata fixtures расширены
полными читаемыми client fields и пустым catalog, не production DDL.

449/449 owner/dependency profile `r04:plans:test` PASS; initial focused 24/24 PASS.
После дополнительных assertions на deleted clients, observed-empty questionnaire
и Node-free profile projection — 8/8 focused, root TypeScript и lint PASS.
Root/mobile TypeScript, scoped lint, source73/arch543/secrets/diff PASS.
Полный foundation, bundle/APK/Hermes runtime и Android
не запускались. SDK mock/Node worker не заменяют native runtime proof.

## Остаётся

Остальная source coverage/preferences/lineage, portable Plans/Execution и другие
projections/writer, permanent Execution/review/provenance модель, schema admission,
композиция полного импорта, ordinary backup всех перенесённых данных, JSON/other
2.0 variants, Android interruption/retry, GC/powerloss и removal/release proof.
R04/D03 и общая задача остаются открытыми, не100%.
