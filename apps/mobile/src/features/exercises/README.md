# ExerciseCatalog

Системные и пользовательские определения упражнений, стабильные ID и
metric/tracking profiles. Переименование не переписывает старые тренировки.

Сохранённый legacy import может иметь bodyPart=null/equipmentUnspecified: данные
не угадываются, обычное создание по-прежнему требует категорию. Legacy2.0 profile
LOAD_REPS, stock provenance LEGACY_V2 отдельно от RepDB. Rules/search/labels и
training lookup различают неизвестность и настоящую классификацию. R04 registry
staging проверяет persisted IDs/links/parity/retry; production imported registry
repository/DDL пока не подключены. Текущий custom_exercises baseline не ослаблен.
