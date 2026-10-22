# R04 — сохраняемый реестр кандидатных ID

Статус: isolated staging prototype / NOT PRODUCTION MIGRATION.
Задача R04, зависимость R03. Product §§1, 10, 46.6: source provenance,
owner isolation, повтор без случайных новых клиентов. Производственная политика
D04 и полный D03 этим срезом не объявляются завершёнными.

## Реализовано

`CandidateIdentityLedger.ts` создаёт **отдельную пустую тестовую SQLite-базу**
с двумя prototype-таблицами `r04_candidate_identity`/`r04_candidate_ids`.
Их нельзя добавлять в runtime, в исходный backup или production baseline.
Это сохраняемый контракт для дальнейшего staging owner, не production DDL.

Реестр привязан к формату 1, SHA-256 конкретного исходного снимка, account scope,
исходному workspace и явному target workspace. Изменение любой части привязки
отклоняется до записи. База с неизвестными объектами не присваивается реестру.
Этот маркер — проверка совместимости, не криптографическая аттестация файла.

Workspace mapping задаётся явно. Client mapping использует canonical source key
`JSON.stringify([accountScope,sourceClientId])` и выделенный UUID. Присвоенный UUID
сохраняется; закрытие/открытие базы, другой порядок входа и повторный проход
возвращают те же ID. Имя клиента не участвует в identity и не записывается в
реестр. Разные клиенты не сливаются по совпавшему имени или похожим данным.

Пакет назначений выполняется в `BEGIN IMMEDIATE`. При ошибке/коллизии весь новый
пакет откатывается; прежние committed mappings сохраняются. Внешняя транзакция
не коммитится и не откатывается этим инструментом. Чтение проверяет контекст,
форму ключей, единственность workspace mapping и client UUID. Callback выделения
ID — внутренний тестовый seam, не пользовательский ввод.

## Соединение с client draft

`loadClientDraftIds()` даёт карты существующему `projectClientIdentityDrafts`.
Обнаружена и исправлена несовместимость старого R04-прототипа: он допускал только
UUID workspace, тогда как D01 production runtime использует `local-trainer`.
Теперь projector принимает дополнительный **явный ожидаемый workspace ID**.
При его наличии требуется точное совпадение; без него сохранена прежняя UUID
проверка. Client IDs остаются UUID. Ошибочная принадлежность или попытка свернуть
несколько source workspace в один по-прежнему блокируют весь результат.

## Проверки и границы

Только синтетические временные базы: повторное открытие файла, два соединения,
отказ на каждом месте выделения ID, коллизия UUID, неверный UUID, сохранение
ранних commits, context/hash drift с проверкой неизменности байтов, чужая база,
неверные/чужие/повторные source keys, повреждённый mapping и внешний transaction.
Интеграция с client projector сохраняет active/archived клиентов в `local-trainer`.

Это injected exception tests, а не Android process-kill/low-disk proof R05.
Условие реального восстановления ещё не выполнено: остаются persisted target
data, business parity, ID maps других владельцев, atomic publication/checkpoints,
проверка исходного SHA над согласованным snapshot и target database identity,
существующие target records, повтор с изменившимся source и recovery на Android.
Новая исходная копия не должна получать доступ к существующему job реестру
путём перезаписи binding. R04/D03/D04/R05 gates остаются открытыми.

В реальной пользовательской базе и на телефоне этот код не запускался.
UI и темы не изменялись.
