# R04 — профиль и история пользовательских анкет в общей staging-транзакции

Дата: 2026-10-23; исходная база кода b3e17bb. Task R04→R03; D03→R04/R05.
Product §§10,22.2,23–27,46.6/46.19,48.5.7,53–56. Статус: PARTIAL,
**synthetic staging rehearsal**, без реальной миграции и изменения production DDL.
Migration/overlay/signing/release gates OPEN. UI/темы остаются на следующий этап.

## Вход и источник формата

Продолжение [переноса 37 полей профиля](R04_CLIENT_PROFILE_STAGING.md).
Точный read-only build120: `e116b42e95f70a5a5e563420ab25394944c59ffd`.
[QuestionnaireRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/data/QuestionnaireRepository.ts)
подтверждает отдельные published revisions, один draft и ссылку ответа на
template_revision. Публикация превращает прежний draft в published и создаёт новый
draft с ordinal+1. Этот ordinal не является CAS revision черновика 3.0.
Описание исходных типов/таблиц — [mapping](R04_QUESTIONNAIRE_MAPPING.md).

Target: актуальные QuestionnaireModel/Rules и настоящие D01 Client/Questionnaire
definitions. Частный стенд не получает отдельную альтернативную production-схему.

## Правила композиции

`LegacyQuestionnaireComposition.ts` строит план из retained raw JSON; сохранённая
derived projection не считается источником истины. Проверяются account/workspace,
уникальные ID/номера версий, даты, единственный последний draft и точные pointers.
Ответы преобразуются только по своей опубликованной версии, без fallback к latest.

- Исторические публикации сохраняют исходные номера и published_at, включая
  промежутки нумерации. Последующие ответы не переписывают историческую схему.
- Добавляется новая migration publication `maxPublished+1` с явным job.createdAt.
  Она объединяет последний published с полями профиля и сохранёнными ответами.
  Профильные ответы ссылаются на эту новую версию; updated_at остаётся временем
  исходной строки clients, а не выдуманной точной датой ответа.
- Исходный draft переносится в target draft, base=migration version, CAS revision=1,
  updated_at=source template.updated_at. Его новые вопросы не публикуются.
- Системный раздел определяется только по legacySectionId, не по подписи. Метаданные
  и порядок существующих wrappers сохраняются; отсутствующие wrappers скрыты.
  Пустые пользовательские разделы сохраняются. Два дополнительных профильных
  вопроса переходят в goals/lifestyle с прежними стабильными ID. Дубли wrappers
  блокируют композицию. Protected billing/notes не превращаются в вопросы.
- Идентичность вопроса зависит от source ID. SHORT_TEXT↔LONG_TEXT остаётся одной
  текстовой сущностью; несовместимая смена типа создаёт новый semantic epoch по
  source revision ID. Возврат к прежнему типу создаёт следующую сущность. Число 0
  не превращается в текст; false, пробелы и порядок выбранных вариантов сохраняются.
- Использованные удалённые вопросы/варианты остаются retired в новой migration
  publication и draft. Старый ответ продолжает ссылаться на исходную версию.
  Переименование строки варианта не угадывается как сохранение его идентичности.
- DELETED и явный NULL не становятся активными ответами. Их полный source и
  disposition сохраняются в private receipt. Change sets остаются audit metadata;
  это не воспроизведение конечных событий/уведомлений приложения.

## Запись и повтор

Явный режим `clientIdentityRehearsal:{createdAt,profiles:true,questionnaires:true}`,
persisted binding `QUESTIONNAIRE_COMPOSITION_V1`, метод `stageClientQuestionnaires`.
Режим отличает отсутствие всех исходных Q-таблиц (`null`) от повреждённого набора.
Старые profile-only staging-файлы не присваиваются новому режиму и не пересобираются.

В одной BEGIN IMMEDIATE записываются client IDs/cards, все Q versions/draft/answers
и private source/target receipt. Он содержит exact revision/section/field/option
maps, dispositions и полный raw source. Read-back всех строк, FK и integrity
проверяются до commit. Вход копируется до callbacks; caller mutation не подменяет
допущенные raw данные. Reopen/reordered replay сравнивает receipt и фактические
строки без UPDATE/REPLACE, новых ID, версий и дат. Source/target drift блокируется.

## Фактические проверки

- `npm run r04:questionnaire:test`: **83/83**, из них 14 новых композиционных тестов
  плюс профиль/карточка/identity/source questionnaire dependencies.
- Все семь типов в SQLite, разные клиенты и архивная карточка, версии/промежутки
  нумерации/даты, смена типа и возврат, retired variants/fields, tombstones/null,
  исходный draft, invalid pointers/owner/schema и duplicate wrappers.
- Пять injected failure checkpoints откатывают новые IDs/cards/Q/receipt вместе;
  последующий retry проходит. Это host exception proof, не Android process death.
- Синтетический файл 2.0 читается read-only в snapshot: SHA до/после совпадает.
  Reopen/reordered replay не меняет байты target; source и target drift не затирают
  committed publication/изменённый draft.
- Root/mobile typecheck, ESLint затронутых scripts, source/architecture/secrets/diff.
  Полный foundation, новый APK и main bundle не запускались: runtime не менялся.
  Новые тесты зарегистрированы в r04/foundation.

## Что остаётся

Результат по-прежнему `finalizable:false`: Notes/ManualTags/Safety пока только
WorkData candidates. Частная DB содержит r04_* объекты и выбранных владельцев;
это не fitcoach_v3.db и публиковать её через restore engine нельзя. Runtime
ExpoRestoreJobs принимает общие 3.0 snapshots; ветка 2.0 ещё не подключена.

Далее — финальные WorkData owners, остальные домены/stable IDs/provenance,
полная staging parity/retry/Android и runtime-конвертер SQLite/JSON v1/v2.
Change sets сохранены как audit metadata, но конечная история ещё не реализована.
Общая цель ACTIVE, R04/D03/R05 и технические gates OPEN; это не 100% переноса.
Телефон, установленная 2.0 и личные резервные копии не затрагивались.
