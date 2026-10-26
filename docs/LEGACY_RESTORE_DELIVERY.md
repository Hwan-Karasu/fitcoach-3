# Перенос 2.0 → 3.x: критический путь до рабочего результата

Сверено с worktree `4fe0abe`, 2026-10-26. Goal ACTIVE, полный перенос не готов.
Владелец справедливо указал на затянувшуюся работу: дальше результат измеряется
сквозными возможностями, а не числом новых проверок отдельного преобразователя.
Объём цели, сохранность данных и открытые технические gates не сокращаются.
R04→R03 / Product §§20.2,22.2–22.3,48.5.7,49–50,53–56 / INT03–12.

| Участок пути | Фактическое состояние | Что доказывает завершение |
|---|---|---|
| Копия источника и допуск | Sealed copy/canonical SQLite v25, pinned snapshot и source SHA проверены. Это не поддержка всех JSON/SQLite вариантов2.0. | Поддерживаемые форматы реального экспорта2.0 имеют fixtures и одинаковые значения/владельцев/ID; исходники неизменны. |
| Сопоставление и private staging | Все текущие owners записываются одной транзакцией, parity/retry/IDs есть; результат явно finalizable:false. Raw retention не равен рабочей проекции. | Полная ведомость источников: каждое значение имеет native назначение или поддерживаемый постоянный review/retained объект; ничто не пропущено молча. |
| Рабочие модели3.x | **Первый существенный разрыв.** Часть native данных уже доказана, WorkData проверен только с candidate owner. Imported Exercise registry и полный Execution ещё private. | Полная native candidate DB открывается обычными repositories без importer; Plans реально разрешают imported exercise IDs; факты/недатированные записи читаются и редактируются с сохранением точности/ID/происхождения. |
| Схема и самодостаточная копия | Обычный snapshot engine существует. Нынешний production registry отвергает новые candidate stores. Узкие backup proofs не закрывают весь путь. | Допущенная схема всех владельцев; 2.0 → native candidate →3.x backup → restore → обычная сборка без importer, с полной сверкой всех owner rows/IDs/reviews/evidence. |
| Подключение и cutover | ExpoRestoreJobs работает с3.x. createLegacyCandidateRuntime не подключён к picker/UI/createServices и не имеет cutover API. | Выбор2.0 копии → понятный предпросмотр → подтверждение → безопасная замена → usable данные; failure/restart/return point/все holders в том же workflow. |
| Android и выпуск | Есть исторические3.x backup и текущие host/SDK-mock проверки. Полный legacy путь на устройстве не доказан. | Проверенный Android путь на копиях, прерывания/повтор/low disk/providers; отдельные signing/overlay/release gates и артефакты переходного выпуска. |

## Следующее изменение

Сначала устранить разрыв между private imported Exercise IDs и обычным каталогом,
затем materialize полный Execution в native модель с его date evidence/partials/
segments/notes. Это обязательные зависимости общей native candidate DB, а не
повод продолжать несвязанные уточнения отдельных полей.

Далее соединить native owners в **одну** проверяемую базу и пройти полный snapshot
restore без импортёра. После соответствующего schema admission подключить этот
результат к существующему app restore/maintenance workflow и Android. Известные
пропуски прочих source semantics/форматов/review остаются в общей ведомости и
должны быть закрыты до выпуска; этот порядок не исключает их из цели.

## Проверяемые места в коде

- `app/composition/stageLegacyImportCandidate.ts`: общий private stage.
- `app/composition/createLegacyCandidateRuntime.ts`: start/resume, без app binding.
- `app/composition/ExpoRestoreJobs.ts`: действующий3.x restore path.
- `features/exercises/data/DevExerciseCatalogRepository.ts`: обычный каталог пока
  использует системный/custom store, не r04 imported registry.
- `features/training/execution/data/legacy-import/LegacyExecutionStagePlan.ts`:
  private facts/contexts/representations, finalizable:false.
- `features/clients/data/SqliteClientWorkDataRepository.ts`: ordinary owner с
  отдельным candidate schema proof; production registry/app wiring ещё отсутствует.

Production DDL, реальная миграция, signing/overlay и release не запускаются до
соответствующих gates. Не объявлять эти участки завершёнными по этому документу.
Excel — после backup/restore, шлифовка UI/тем — после основного функционала.
