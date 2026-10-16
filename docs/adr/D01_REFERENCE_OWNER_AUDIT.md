# D01 — проверка owner-связей справочной схемы

**Статус 2026-10-15: CANDIDATE / NOT PRODUCTION DDL / D01 NOT DONE.**
Вход: Stage 3 `reference-only/sql/001_reference_schema.sql` из синхронизированного
пакета документов. Зависимости D01: F04 и R04 остаются частичными; Product
§§10,13,22,48.5.7,49–50 и Stage 3 SQLite/ownership contract обязательны.
Рабочая схема, миграционные version-файлы, EXPLAIN на целевых запросах и
Android/restore gate не утверждены.

Локальный TS-пробник исполняет справочный SQL и, во втором сценарии, отдельный
кандидат ограничений **только в памяти**. Он пробует синтетические строки двух
workspaces и ничего не пишет в приложение,
переданный `.atbackup` или production SQLite. Воспроизведение:

```powershell
npm run d01:reference-probe -- ..\FitCoach_3_DOCUMENTS_SYNCED_2026-10-14\03-Data-Technical\reference-only\sql\001_reference_schema.sql
npm run d01:reference:test
```

| Связь с заведомо чужим owner | Результат reference SQLite | Требование до D01 approval |
|---|---|---|
| Appointment W1 → Client W2 | Отклонена | Сохранить проверку и для INSERT/UPDATE. |
| Appointment W1 → SessionType W2 | **Принята** | Ограничить тип workspace записи, включая UPDATE и тарифы/пакеты с типом. |
| FoodDiaryEntry клиента W1 → Product W2 | **Принята** | Проверить same-workspace reference с учётом полиморфного Product/Recipe и независимого исторического snapshot. |
| TrainingProgram клиента W1 → Cohort W2 | **Принята** | Ограничить cohort workspace по владельцу программы, включая UPDATE. |
| Measurement primary клиента C1 → measurement C2 | Отклонена | Сохранить client/metric/date-инвариант. |
| WorkoutSession клиента C1 → Program C2 | Отклонена | Сохранить client/program-инвариант. |
| После корректной Session C2 → Program P2 поменять `P2.client_id` на C1 | **Принята** | Запретить смену owner у программы с зависимыми фактами или обеспечить атомарную проверенную коррекцию, не переписывая историю. |
| После корректной primary C2 → Measurement M2 поменять `M2.client_id` на C1 | **Принята** | Защитить существующий primary при изменении measurement owner/metric/date; выбор не должен указывать на чужую точку. |

Ещё семь сценариев reference SQL приняли смену уже установленной связи:
Appointment→чужой SessionType, FoodDiaryEntry→чужой Product,
TrainingProgram→чужую Cohort, а также смену workspace у связанных
SessionType, Product, Recipe и Cohort. Экспериментальный overlay в
`scripts/d01/CandidateOwnerGuards.ts` отклоняет все 15 опасных сценариев
и допускает шесть позитивных операций с собственными связями или обычным
обновлением. Это проверка узкого набора инвариантов, **не** одобренная
миграция и не доказательство полноты ограничений.

`foreign_keys=ON` при выполнении reference SQL; пропуски не исправляются одним
FK по `id`: существование чужой строки не подтверждает ownership, а изменение
owner родительской строки может разрушить ранее корректную связь при
`foreign_key_check=0`. Нужны составные FK или эквивалентные guards на обе
стороны связи, tests на INSERT и UPDATE обоих концов
и безопасный путь для исторического снимка после удаления/архива источника.
До выбора политики `source_id` с отсутствующим каталогом нельзя молча
приписывать ему новый продукт. Это выявленные требования к проектированию,
не новая Product-норма и не разрешение копировать reference DDL в приложение.

Открыты, в частности: смена `clients.workspace_id`, владельцы тарифов,
пакетов и recipe ingredients, удаление/архивация каталога при историческом
snapshot, correction/transfer workflows и проверка всех parent/child UPDATE.
Кандидат блокирует перенос workspace связанного каталожного объекта, но
это временная защитная гипотеза, а не утверждённая политика продукта.

Выход пробника имеет `productionSchemaApproved=false`, `targetWrites=0`.
Локальный тест читает тот же авторитетный reference SQL из соседнего пакета;
он не включён в CI checkout без этого пакета и **не** проверяет будущую
production-схему. Его назначение — зафиксировать наблюдённый baseline,
а не считать выявленные пропуски допустимыми.
Следующее доказательство D01: явная production-модель владельцев и версий
миграций; тесты FK/guards, rollback, EXPLAIN и Android Debug/Release; затем
R04 parity/staging и безопасное восстановление по D03/D05.
