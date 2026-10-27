# R04: незасчитанные значения подходов

2026-10-24, база `b64fac9`. R04 → R03, Product §§48.5.7, 48.44, 48.52,
49–50, 53–56, INT-03–12. Production/migration/overlay/signing/release gates OPEN.
Изменена только private R04 projection, не production DDL и не приложение.

`LegacyEditableSet` разбирает значения представления `UNCONFIRMED` отдельно от
канонического выполненного факта. Результат включается в `context_json` уже
существующей `r04_execution_representations` внутри общей транзакции владельцев.
Новые таблицы, ID, отдельный журнал или подтверждение подхода не добавляются.

- Пустое поле остаётся `null`. Явный ноль сохраняется нулём с `confirmed:false`.
- Точные килограммы переводятся в целые граммы существующим преобразователем,
  без округления. Все сегменты частичного дроп-сета сохраняются независимо.
- Kind и failure effort остаются отдельными полями, RPE — отдельным значением.
- Неизвестный/ошибочный ввод получает фиксированную причину review; исходные
  строки остаются в source representation/полном source receipt. Невалидное
  значение не заменяется нулём. Пустое поле само по себе не ошибка.
- `hasInput` различает пустой черновик и реально введённые данные, включая
  неразобранный текст. Плановые reps/weight не подставляются в факт.
- У черновика нет ID подтверждённого факта/сессии. Сведения о плане и физическом
  источнике сохраняются; окончательная привязка к runtime пока не реализована.
- Старый private receipt без `editableProjectionVersion:1` не проходит guarded
  read/replay. Не объявляется проверенным для нового преобразования. Этот
  отказ относится к синтетическим R04 jobs; production базы не мигрируются.

3 новых интеграционных теста: явные нули и неизменность source; частичный DROP с
независимым effort/ошибочным текстом/пустыми полями при наличии плана; отказ старого
receipt. Проверка target drift включает подмену editable.confirmed. Существующие
22 transaction boundaries, rollback/retry, read-only source, reopen/reorder,
byte-identical parity и устойчивые ID также прошли.

Фактически: 309/309 `r04:plans:test` (22 canonical Execution tests), root/mobile
TypeScript, ESLint изменённых файлов, source73/secrets/diff. Runtime не менялся
после проверенной сборки JS из `b64fac9`; новый bundle/APK/native/fullfoundation
для этого среза не запускались. Параллельные изменения тем не включаются в commit.
`finalizable:false`, реальный legacy restore всё ещё не подключён.

## Уточнения для следующего сопоставления

Проверен точный legacy ref `e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [TrainingSetLogRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingSetLogRepository.ts):
  update различает structural-only изменение и изменение введённых значений;
  невалидный/неполный сегмент снимает completion, плановые поля живут отдельно.
- [activeProgramViewModel](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/activeProgramViewModel.ts):
  карточка вычисляет planned/in_progress/completed по completedAt и полноте всех
  подходов; это отдельное свидетельство, не доказательство ручного исхода 3.x.
- [TrainingWorkoutRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingWorkoutRepository.ts),
  [workoutDetailViewModel](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/workoutDetailViewModel.ts):
  workout data.note и exercise data.diaryNote — записи дневника, exercise.note —
  указание плана. Их нельзя смешивать, включая объекты без засчитанных подходов.
- [buildTrainingArchiveSnapshot](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/model/buildTrainingArchiveSnapshot.ts):
  completedWorkouts берётся из сохранённых status completed/done, сами snapshots
  сохраняют data. Это не тождественно алгоритму live карточки выше.

Следующий этап: связать эти свидетельства и заметки с физической workout identity,
в том числе при отсутствии выполненных фактов; сохранить различия live/archive,
не объявляя любой заполненный набор подходов явным исходом 3.x. Полная запись
editable значений в runtime и проверка пользовательского редактирования остаются.
