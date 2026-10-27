# R04: дневной вес и недатированный снимок профиля

2026-10-24, база `c56c3f7`. R04 → R03; Product §§10, 48.86.36,
49.14–49.18, 49–50, 53–56, INT-03–12. Входы: immutable Clients/Measurements
snapshots, проверенная client ID map и существующая D01 baseline замеров.
Migration/production DDL/overlay/signing/release gates OPEN. Synthetic staging.

## Доказательство источников

Read-only `Hwan-Karasu/fitcoach@e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [ClientDayFactsRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/data/ClientDayFactsRepository.ts#L86)
  сохраняет weight для ключа client_id/date_key, независимо от steps/training.
  updated_at меняется также при редактировании других полей: это не время взвешивания.
- [clientHomeCopy](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/model/clientHomeCopy.ts#L34)
  задаёт единицу «Вес, кг» для
  [HomeDailySection](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/ui/home/HomeDailySection.tsx#L43).
- [resolveTodayEntry](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/model/clientHomeViewModel.ts#L133)
  мог подставить clients.weight при отсутствии дневного значения.
  [ClientHomeScreen](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/screens/ClientHomeScreen.tsx#L233)
  сохраняет поле дня на blur, затем может обновить профиль. Источник доказывает
  сохранённое дневное значение; он не доказывает отдельное новое взвешивание
  каждый раз. Эта неопределённость остаётся в provenance.
- [kbjuProfileSeed](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/kbjuProfileSeed.ts#L65)
  копирует вес профиля в параметры калькулятора. Данные калькулятора, включая
  fatPercent, сами по себе не создают Body Measurements; их владелец ещё переносится.

## Запись и сверка

Measurements snapshot теперь содержит все строки/столбцы client_measurements и
client_day_facts; отсутствие каждой таблицы отдельно остаётся null. Проверяется
полная известная форма. Из raw дневных строк заново выводятся ключи и значения;
дубли ключа и неизвестный клиент откатывают всех владельцев. Steps/training/extras
пока сохраняются raw, не становятся выполненными Workout/Calendar/Ledger фактами.

Непустой корректный дневной вес получает устойчивый ID по
`accountScope/client_day_facts/clientId/dateKey/weight`, тип WEIGHT, точные десятые
килограмма и исходную дату с localMinute=null. Проверка диапазона/даты общая с
обхватами. Запятая, ведущие/завершающие нули и явный плюс не теряют значение;
нуль, отрицательный нуль/вес, лишняя точность, неверная/будущая дата остаются review
с raw и targetId=null. Ничего не округляется и не заменяется нулём.

Равные веса разных дат/клиентов остаются отдельными фактами. Основное значение
не назначается. Provenance помечает `SAVED_DAY_VALUE_PROFILE_PREFILL_POSSIBLE`,
не выдавая сохранённое поле за доказательство нового измерения. Существующие
датированные значения не стираются по сравнению с сегодняшним профилем.

Clients.weight сохраняется со своим source key, присутствием поля и raw значением
в source receipt; непустые снимки имеют UNKNOWN date, причину отсутствия даты и
targetId=null. Ни время создания/правки клиента, ни дата импорта, ни совпадение с
одним из дневных весов не создают из него дополнительный BodyMeasurement. Агрегат
reconciliation показывает только сигналы совпадения/различия, не служит matcher.

Всё записывается существующим stageClientMeasurements в общей транзакции после
предыдущих владельцев. Источник frozen до callback предыдущего владельца; SHA,
target parity и устойчивые ID охватывают дневные строки и профильные сигналы.
Новых таблиц/production DDL нет. Mode MEASUREMENTS_REHEARSAL_V2 и projectionVersion2
отклоняют прежние private задания без их пересборки/автоматического объявления
проверенными. Исходные старые файлы этим не изменяются.

## Фактическая проверка

460/460 целевых тестов: R04 Plans и зависимости measurement projection/source
preflight/extended/Navy/client-bodyweight/SQLite backup. Семь новых тестов;
в существующих file/retry/runtime/общей транзакции теперь участвует дневной вес.
Read-only source и target reopen/reordered rows/properties дают те же ID/bytes;
source-only drift, пропущенное покрытие, старый mode/manifest, owner/duplicate
отклоняются. Новые измерения не берут дату из профиля; одинаковые дни/значения
не создают merge, пустой вес/training=Да не создаёт тренировку.

Три measurement checkpoints и before-commit проверены с непустыми предыдущими
владельцами, обхватом и весом: полный rollback/client IDs и чистый retry.
Обычный репозиторий читает/correct-ит записанные факты, сохраняет ID/revision и
явный primary. Дополнительный путь: D01 rows → свежая полная обычная 3.x БД →
самодостаточная .atbackup → восстановленная 3.x БД → обычный репозиторий. Все
нормализованные measurement ID/строки совпали; исходная рабочая БД и backup не
изменились; в восстановленной БД нет private r04 tables.

Эта последняя проверка доказывает переносимость нормализованных фактов замеров,
а не всего legacy импорта или private review/provenance. Для них production
storage/backup/UI ещё требуется завершить. Сам импортёр в APK не удалялся.

Root/mobile TypeScript, ESLint изменённых файлов, source73, sensitive-files и
diff check прошли. Bundle/fullfoundation/APK/native/телефон не запускались.
`finalizable:false`, полный legacy restore к приложению ещё не подключён.
Следующие владельцы: дневные steps/прочие данные, Nutrition/calculator/catalog/
recipes/history, Calendar/Ledger; остаются Execution storage/outcomes и Android gates.
