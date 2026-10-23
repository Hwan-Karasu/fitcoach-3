# R04 — шаблоны 2.0 в изолированном staging

Следующий срез после74fa6cf: [R04_ARCHIVE_PLANS_STAGING.md](R04_ARCHIVE_PLANS_STAGING.md)
реализует структуру архивных Plans. Упоминание «ещё не реализовано» ниже относится
к состоянию этого исходного template-среза; canonical факты по-прежнему не созданы.

2026-10-23; входная база92d00bb. Task R04→R03; D03→D01/R04/R05.
Входы: raw Plans source, Client/Exercise maps, общий Client/Q/WorkData/catalog/Plans
staging. Product §§48.12–48.16,33,39,46.6/46.19,49–50,53–56. Migration,
overlay, signing и release gates OPEN. Только synthetic rehearsal; новая production
DDL, приложение, телефон и реальные данные не менялись. finalizable:false.

## Проверенные исходники

Readonly build120 e116b42e95f70a5a5e563420ab25394944c59ffd:

- [ProgramTemplateService](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/ProgramTemplateService.ts)
  и [027_template_ownership](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/027_template_ownership.ts)
  задают account binding template_workspace_id. Это отдельно от client_id автора.
- [saveSimpleProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/saveSimpleProgram.ts)
  материализует недели простой программы; сохранённый шаблон имеет book_id=null.
- [savePeriodizedProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/savePeriodizedProgram.ts)
  сохраняет один draft мезоцикла с его неделями, а не книгу. Отсюда соответствие
  старого periodized template → MESOCYCLE 3.0.
- [cleanProgramTemplate](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/cleanProgramTemplate.ts)
  исключает выполнения и warmup из шаблона. Мигратор не исполняет этот старый код,
  а проецирует только явные plan JSON поля собственным проверенным преобразованием.

Для следующего этапа также просмотрены archiveTypes/buildTrainingArchiveSnapshot,
TrainingArchiveRepository/archiveTrainingProgram. Архив хранит снимок всей книги;
корневые workouts могут повторять содержимое cycles со смещёнными weekIndex.
Следовательно, root/cycle occurrences нельзя считать разными выполнениями.
Старый parser заменял повреждённый JSON пустым снимком — такое поведение не переносится.
Это исследование источника, **не реализованное преобразование архивов**.

## Реализация

Отдельное templates:true требует plans/exercises/workData/questionnaires/profiles:true.
Persisted TRAINING_TEMPLATES_REHEARSAL_V1 не позволяет присвоить прежний job-файл.
Общий stageClientPlans пишет Client/Q/WorkData/catalog/Plans/templates одной
BEGIN IMMEDIATE. Используется существующая D01 training_templates только внутри
частной rehearsal DB. Production schema и migrations не менялись.

| Источник | Результат |
|---|---|
| Live free template | SIMPLE с числом недель и общим планом |
| Live periodized template | MESOCYCLE со всеми неделями и их типами |
| template_workspace_id | Должен точно совпадать с sourceWorkspaceId; missing/foreign блокирует |
| title/created_at/updated_at | Сохраняются; новая revision=1, старую revision не выдумываем |
| Plan JSON | Тот же exact range/RIR/grams mapper, что для live Plans |
| Упражнения/указания/отдых/supersets | Стабильные IDs и проверенные ссылки в общий registry |
| Actual reps/weight/RPE/completion/segments/history | Только полный raw source; отсутствуют в template payload |
| Участники/sharedGroup/lineage/даты выполнения | Не становятся связями шаблона |
| Deleted template/descendants, warmup | Retained source без возвращения в библиотеку |

Старый source author client остаётся в provenance, не в payload. Шаблон не создаёт
Program/member или выбранный мезоцикл. Alias root указывает Template ID и
programId=null; источник распознаётся по TEMPLATE_PLAN. Недели не получают
выдуманный persisted target Week ID. Сами шаблоны не создают Training facts.

Для SIMPLE все физические недели сравниваются после проекции только плана.
Разные actual values не мешают сравнению. Эквивалентные workout/exercise/set и
superset slots получают общие IDs по порядку, с сохранением каждой raw строки
и source weekIndex. Эти aliases относятся к шаблону, не являются ключами dedup фактов.
Применение использует обычные workoutsFromTemplate/weeksFromTemplate и создаёт
новые ID. Одинаковые названия разных шаблонов не сливаются.

Receipt включает 11 target tables, весь raw source, ID ledger, metadata и plan bases.
Чтение aliases повторно сверяет таблицы, source rows и IDs, включая templates.
Не заявленные этим режимом draft/history/template rows должны оставаться пустыми.
Повтор не обновляет успешный результат и не ремонтирует повреждённые данные.

## Доказательства и ограничения

- npm run r04:plans:test: **248/248**, включая30 R04 Plans tests (12 новых в этом
  срезе) и6 обычных Template tests. Root/mobile TypeScript, changed ESLint,
  source73/arch506/secrets/diff pass.
- Все15 границ Plans/templates/receipt/commit проверены injected failure: откат
  всех владельцев, затем успешный retry. Source hash неизменён; после reopen и
  перестановки исходных строк target file byte-identical, allocator не вызывается.
- Проверены actual contamination, owner/missing-column/book/week/JSON failures,
  duplicate titles, deleted ancestors, typed weeks/superset/warmup, source/target
  drift, mode binding и отказ alias-read при посторонней записи template.
- StoredTemplate принимает payload; обычные domain copy helpers создают независимый
  план. Production runtime initialization/restore и телефон этим не проверены.

Текущая SIMPLE TemplatePayload не представляет отличия плана по неделям. Если такие
данные обнаружены, весь job откатывается с SIMPLE_TEMPLATE_WEEKS_UNREPRESENTABLE;
исходник сохраняется. Это **открытый вопрос совместимости**, а не законченный импорт
всех допустимых старых шаблонов. Нельзя подменять недели первой или молча менять тип.
Book-bound legacy templates также не интерпретируются как целая книга без доказательств.

Старые cycle_type/repRange/startDate/прочие settings сохраняются в raw/metadata,
но отдельными свойствами текущего TemplateMesocycle не становятся. Плановые значения
подходов переносятся по их явным полям, не по придуманным defaults. Полное покрытие
этих настроек, реальные архивы/выполнения/даты/segments/dedup, остальные владельцы,
production WorkData/registry wiring, runtime SQLite/JSON1/2 Restore и Android впереди.
Полный foundation/APK/bundle не запускались: runtime source в этом срезе не менялся.
