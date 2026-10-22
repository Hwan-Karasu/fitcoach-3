# R04 — транзакционная репетиция записи client identity

Статус: SYNTHETIC REHEARSAL / NOT PRODUCTION MIGRATION.
Продолжение: [поля карточки и persisted raw source profile](R04_CLIENT_CARD_PROJECTION.md),
отдельный метод stageClientCards; identity-only replay не подменяет card replay.
Задача R04, зависимость R03. Product §§1, 10, 46.6: owner isolation,
стабильные ID, сохранение архивности и повтор без частичной записи.

## Схема и привязка

`prepareCandidateIdentityLedger` получил явный opt-in `clientIdentityRehearsal`
со временем создания тестового job. В этом режиме в отдельной тестовой базе
создаются `workspaces` и `clients` из **текущего D01 ClientsBaseline.generated**:
без ручной копии SQL, изменений baseline или новой production migration.
Остальные таблицы и triggers владельца здесь не создаются. Это не полноценная
база приложения и не файл, который можно публиковать как fitcoach_v3.db.

Режим и время job входят в persisted context binding вместе с source SHA,
account/source workspace и явным target workspace. База обычного ledger и
база rehearsal не подменяют друг друга; чужая/production/source база не
присваивается. FK включается до транзакции и проверяется при записи.

## Один commit для IDs и строк

`stageClientIdentities` выполняет в одной `BEGIN IMMEDIATE`:

1. Проверку account/workspace и существующего реестра.
2. Назначение отсутствующих client UUID.
3. Строгую pure-проекцию всех source клиентов; blocked projection откатывает IDs.
4. INSERT identity-колонок в clients с source created/updated/archive timestamps.
5. Read-back parity, точное число строк, FK/integrity check и commit.

ACTIVE/ARCHIVED сохраняются. Revision=1 — начальная CAS-ревизия новой тестовой
записи, а не выдуманная исходная ревизия клиента. Новый workspace создаётся
со временем тестового job; дата рождения или время измерения из него не выводятся.
Телефон/email/birth date/height/emoji/sex остаются NULL, потому что этот шаг
проверяет **только identity**, а их source mapping ещё не подключён.

Повтор сравнивает уже записанные строки, а не делает UPDATE/REPLACE: нет новых
ID, increments revision или перезаписи дат. Несовпадение payload, неизвестная
строка/owner, частичный список вместо полного и уже появившиеся profile-поля
отклоняются без их удаления. Позднейший полноценный D03 должен различать фазы
и payload checkpoints: после записи профиля нельзя безусловно повторять этот
identity-only rehearsal вместо проверки всей итоговой записи.

## Проверки и ограничения

Только синтетические БД. Тесты проверяют active/archived identity, точные даты,
контроль NULL неперенесённых полей, reopen и перестановку input, сохранение ранних
ID commits, отказ после ID, после первого/второго клиента и перед commit.
Новые client rows и IDs откатываются вместе; ранее сохранённые IDs остаются.
Проверены недопустимая проекция, реальный CHECK clients, конфликт target payload,
профиль, частичный/чужой input, отключённый FK и неизвестная строка.

Checkpoint callback — внутренний синтетический fault-injection seam. Исключения
не доказывают Android process kill/low-disk R05. Не реализованы полный профиль,
анкеты и зависимые факты в той же итоговой БД, orchestration/checkpoint manifest,
atomic file publication, restore и Android. Рабочая база/телефон не затрагивались.
R04/D03/D04/R05 gates остаются открытыми. UI/темы не менялись.
