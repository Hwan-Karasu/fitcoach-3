# R04 — преобразование анкет 2.0 в модель 3.x

Статус: PARTIAL, target-shaped projection в памяти, без публикации схем и записей.
Задача R04, зависимость R03. Product §§23, 25, 27 и §46.6; Feature 07/18.

## Подтверждённый источник

Read-only build120 `e116b42e95f70a5a5e563420ab25394944c59ffd`:
[тип схемы и ответа](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/questionnaire.ts),
[таблицы](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/018_questionnaire_builder.ts),
[работа с версиями и ответами](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/data/QuestionnaireRepository.ts).

У версии схемы JSON (`version=1`) и опубликованной ревизии разные значения.
Ответ связан с `(client_id,question_id)` и `template_revision`. Варианты выбора
2.0 — строки, в 3.x — option IDs. Вызов старого normalizer недопустим:
он подменял неизвестные типы вопроса, некорректную схему и недостающие ID.

## Реализовано

`LegacyQuestionnaireProjection.ts` строит настоящий `QuestionnaireSchema`
formatVersion=1 и проверяет его `validateSchema` приложения. Соответствуют
все семь типов. Вопросы переносятся как CUSTOM без угаданного semanticKey;
системные поля новой анкеты не подменяются по похожим подписям.

Candidate IDs получаются детерминированно из account/workspace/source question
ID; option ID дополнительно использует точную строку варианта. Переименование
вопроса и перестановка вариантов ID не меняют. Переименование старой строки
варианта нельзя доказать автоматически: оно не трактуется как тот же option.
Фактический mapping версий в persisted target ledger ещё предстоит завершить.

Исходные подписи, описания, required/hidden сохраняются. Доступ trainer_only
остаётся в raw source; V1 trainer-only не получает client-role разрешений.
Protected billing/notes wrapper с вопросами блокирует автоматическое
превращение в редактируемый системный раздел. Пустые старые wrappers без вопросов
не создают фиктивные новые вопросы; их метаданные остаются в исходном JSON.
Legacy typed client profile вне questions[] требует отдельного mapping.

`LegacyQuestionnaireSourceReader.ts` сохраняет raw templates, все revisions,
все ответы, включая deleted, и change sets при наличии таблицы. Pointer схемы
проверяется по workspace и статусу draft/published. Ответ преобразуется только
при единственном соответствии его версии опубликованной схеме клиента.
Нет fallback к latest, переноса ответов из draft или подстановки чужого workspace.

Choice labels преобразуются в IDs по точному соответствию. Null, false, zero,
даты, текст и пробелы не подменяются. `answerProblem` приложения проверяет тип
и допустимость. Неизвестный вопрос/вариант, дубликат, ошибочная дата, нечисловой
number, невалидный JSON и неподдерживаемые свойства не удаляются из source:
raw остаётся в inventory, projection блокируется с фиксированной причиной.

В едином read-only `r04:full` есть безопасный агрегат `questionnaire` без ответов,
подписей и исходных ID. Когда ни одной из трёх основных таблиц нет, секция null.
Частичный набор таблиц или несовместимые колонки не выдаются за пустую анкету.

## Проверки и границы

Синтетические тесты проверяют все типы, устойчивость ID, выбор, неизвестные
значения, дубликаты, protected sections, deleted/hidden, версии, workspace,
ошибки JSON и приватность отчёта. Файловый полный R04 проверяет target-shaped
кандидат ответа и неизменность байтов исходника.

Открыты: mapping legacy typed client profile, объединение с существующей схемой
3.x, история удалённых/переименованных вариантов между старыми ревизиями,
публикация версий, persisted ID/version ledger, target parity, миграция change
sets и транзакционная запись. Проектор не выбирает активную анкету, не включает
удалённые ответы и не публикует частично преобразованную версию.
R04/D03/restore остаются OPEN; реальная пользовательская база не открывалась.
