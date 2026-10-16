# Clients · ClientWorkData · ClientArchive

Identity, basic profile и lifecycle клиента; отдельно — рабочие заметки,
ограничения безопасности и оркестрация архива/удаления. Анкета, измерения,
абонементы и тренировки остаются у своих владельцев.

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
manifest блокирует удаление (fail closed); Calendar-последствия §15.8
подключаются вместе с Calendar.

`domain/ClientRepositoryPort.ts` — UI-facing контракт без SQL handle.
Это не D01 production DDL и не совместимо автоматически с legacy backup;
dev-данные пока не имеют собственного backup/restore.
