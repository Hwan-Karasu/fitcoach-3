# Clients · ClientWorkData · ClientArchive

Identity, basic profile и lifecycle клиента; отдельно — рабочие заметки,
ограничения безопасности и оркестрация архива/удаления. Анкета, измерения,
абонементы и тренировки остаются у своих владельцев.

`domain/ClientWorkDataModel.ts` задаёт отдельные TrainerNote, TrainerTag,
ClientTagAssignment и SafetyImportReview (§§10.15/20.2/22.2). Версионированная
нормализация имён ручных тегов учитывает NFC, пробелы и регистр без транслитерации.
Импортированная health-информация не создаёт ACTIVE limitation. Нормализованные
записи и stable IDs проверены в частном R04 staging; runtime repository/DDL/UI
этого владельца пока не подключены. Reference client_work_data JSON blob не
является реализацией актуальных Notes/Tags.

Dev-only вертикальный срез использует `data/DevClientRepository.ts` и отдельную
SQLite-базу для новых карточек: создание, редактирование имени/контактов,
даты рождения/роста/emoji, список, архив и восстановление. Recovery Draft
хранится отдельно, не является бизнес-карточкой и очищается атомарно при
успешном сохранении.

`domain/ClientRosterPort.ts` и `domain/ClientRosterPresentation.ts` отделяют
workspace-scoped активность, сортировку и локальный birthday presentation от
SQLite и UI. Dev roster показывает Birthday → Recent → Regular без дублей,
плоский поиск и occurrence-based unpin. Экран roster settings сохраняет pin,
lead days и badge отдельно. Today/Calendar и production read model ещё не
подключены; C01 остаётся частичным.

`domain/ClientArchivePort.ts` — C04: сортировка Архива, счётчики
Active/Archived и окончательное удаление только ARCHIVED-клиента по явному
manifest владельцев. Новая таблица со ссылкой на клиента без записи в
manifest блокирует удаление (fail closed). Другие владельцы участвуют через
`DevClientDeletionParticipant`, который подключает composition root; так
Calendar выполняет §15.8 в той же транзакции.

`domain/ClientRepositoryPort.ts` — UI-facing контракт без SQL handle.
Это не D01 production DDL и не совместимо автоматически с legacy backup;
dev-данные пока не имеют собственного backup/restore.
