# Feature owners

Физическая группировка следует Architecture Design §10; логические владельцы
перечислены в §4. `clients/` включает отдельные поддомены Clients,
ClientWorkData и ClientArchive; `training/` разделяет Plans, Execution,
Analytics и ClientTrainingArchive. Совместная папка не означает общую таблицу
или право менять факты другого владельца.

Каждая фича будет экспортировать только утверждённый `public.ts` с командами и
запросами. Прямой импорт из чужих `data/`, `screens/`, `internal/` запрещён.
Реальные API добавляются вместе с соответствующей задачей backlog и тестами.
