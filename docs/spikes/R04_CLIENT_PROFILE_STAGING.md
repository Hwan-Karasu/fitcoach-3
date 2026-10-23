# R04 — старый профиль → ответы новой анкеты и транзакционная запись

Дата2026-10-23, база1e3e7ed. R04→R03; D03→R04/R05. Product §§10,22.2,23–27,
46.6/46.19,48.5.7, §§53–56. **SYNTHETIC STAGING REHEARSAL, не production migration.**
Исходную БД, установленную2.0 и production DDL этот срез не меняет. UI/темы позже.

## Точные входы

Read-only build120 commit `e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [ClientProfileFields, все37 полей](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/index.ts).
- [Исходные варианты выбора и явные алиасы мышц](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/client-form-options.ts).
- [Смысл healthCleared и отображение старых полей](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/screens/ClientFormScreen.tsx).
- [Прежняя классификация health labels](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/model/clientHealth.ts).

Это источник формата/значений, не разрешение копировать прежние продуктовые правила.
Target — текущие QuestionnaireModel/Rules и Clients/QuestionnaireBaseline.generated,
без ручной альтернативной схемы production-владельцев.

## Сопоставление всех37 полей

`LegacyClientProfileProjection` различает отсутствующее свойство, пустой ответ и
явный false. Он не дополняет sparse profile выдуманными значениями.

| Source | Target/назначение |
|---|---|
| goals/goalsOther/muscles/successCriteria/deadline | sys:goals.main/other/muscles/success/deadline |
| diagnoses/healthCleared/medications/supplements/injuries/surgeries/pain/hardMovements | соответствующие sys:health.*, healthCleared→noContra |
| currentActivity/sportHistory/fitnessLevel/job/sittingHours/sleep/habits | соответствующие sys:lifestyle.*, fitnessLevel→fitness, sittingHours→sitting |
| bodySatisfaction/weightHistory/dietRestrictions/eatingBehavior | sys:nutrition.bodySatisfaction/attempts/restrictions/eating |
| motivation/obstacles/support/trainerExpectations | sys:motivation.drivers/obstacles/support/expectations |
| menstrualCycle/trainerExperience | sys:extra.cycle/trainerExperience |
| successCriteriaOther/gymAccess | два CUSTOM поля с постоянными legacy:profile:* ID, отдельный импортированный раздел |
| trainerNotes/trainerTags/unwantedLoad | отдельные WorkData candidates, не редактируемые вопросы и не финальные operational records |
| steps/photo | сохранены в private provenance с явным excludedByProduct; steps/photo-аватары не входят в V1 |

30 стандартных соответствий +2 дополнительных +3 WorkData +2 исключённых=37.
Значения выбора превращаются в актуальные стабильные option IDs. Допустимы только
проверенные изменения написания: Бедра→Бёдра, два старых алиаса рук, дефис→тире
в трёх интервалах сидения, четкий→чёткий в одном варианте ожиданий. Нечёткий поиск,
изменение регистра, угадывание нового варианта и удаление дублей не применяются.

Неизвестное поле/тип/вариант, дублированный выбор или непредставимый текст блокируют
весь профиль, сохраняя raw source. Текст не обрезается. История веса остаётся текстом
анкеты и не создаёт измерение. Поля WorkData также разбираются по исходным типам.

Историческое правило этого среза (заменено исправлением ниже): если `healthCleared=true`, а в прежних полях есть содержательные данные, которые
новая visibility-логика спрятала бы, нужен разбор конфликта отображения. Это **не**
медицинский вывод о наличии противопоказаний; галочка не меняется на false наугад.
Исходные детали сохраняются. Кандидатные safety sources не становятся финальными
Safety/Limitations автоматически; это остаётся задачей отдельного владельца.

Уточнение 2026-10-23: [WorkData staging и health visibility](R04_CLIENT_WORK_DATA_STAGING.md)
исправляют скрытие заполненных health details по Product10.15. Теперь оба исходных
значения сохраняются без blocking clearance conflict и без изменения галочки.
Notes/ManualTags/PENDING_REVIEW записаны отдельными normalized rows в частном
стенде, но production WorkData repository/DDL ещё не подключены.

## Одна транзакция и read-back parity

`prepareCandidateIdentityLedger(..., {clientIdentityRehearsal:{createdAt,profiles:true}})`
имеет отдельную persisted binding `PROFILE_REHEARSAL_V1`. Старые candidate/rehearsal
файлы не пересобираются и не присваиваются новому режиму.

`stageClientProfiles` в одной BEGIN IMMEDIATE:

1. Снимает копию входа и повторно разбирает profile из retained raw JSON. Изменяемый
   caller или устаревший derived object не выбирает фактически записанные ответы.
2. Проверяет scope/полную карточку и резервирует стабильные client IDs.
3. Записывает Client identity/card, затем настоящие D01 questionnaire_versions,
   questionnaire_drafts и questionnaire_answers. Применяются исходные CHECK/FK/
   immutable-version triggers; composite client FK обеспечен актуальным D01 index.
4. Сохраняет private r04_profile_receipt с полным source/target manifest, включая
   отдельные WorkData candidates и product exclusions.
5. Сверяет все значения/числа строк, FK/integrity и фиксирует commit.

Новая версия анкеты1 — версия **импортированной target-схемы**, не присвоенный номер
legacy custom revision. published_at/draft updated_at берутся из явного job.createdAt;
это время подготовки новой схемы. updated_at ответов — исходный clients.updated_at,
то есть известное время строки профиля, а не выдуманная точная дата ответа.

Reopen/retry сравнивает все строки и receipt, не выполняет UPDATE/REPLACE. Новые ID,
ревизии и даты при replay не возникают. Неизвестные/изменённые target ответы,
отсутствующий receipt при уже заполненной анкете и source drift блокируют запись.
Предыдущие committed ID сохраняются при неудаче новой партии. Можно продолжить
client-card phase в том же profile-enabled job без переназначения IDs.

Результат содержит `finalizable:false`: WorkData candidates ещё не записаны в
окончательный Notes/Tags/Safety owner. Только сохранение raw/candidates не объявлено
полным переносом этих данных.

## Фактическая проверка и границы

- `npm run r04:profile:test`: **69/69**, включая17 новых profile tests и зависимости.
- Downstream synthetic `r04-source-fact-preflight.test.ts`: **82/82**, включая full
  read-only audit. Aggregate clientCards теперь содержит только profile counts,
  review/workData counts; имена/ответы/заметки/IDs не выходят в отчёт; targetWrites=0.
- Файл synthetic2.0→read-only snapshot→identity/card readers→staging: active/archived
  клиенты и32ответа; SHA source до/после совпал. File reopen/reordered replay оставил
  байты target неизменными. Шесть точек injected failure откатывают IDs/cards/схему/
  ответы/receipt вместе. Это host exception proof, **не Android process kill**.
- Root/mobile typecheck, lint затронутых scripts, source/arch505/secrets/diff.
  Полный foundation не запускался; новый test зарегистрирован в r04/foundation.
  Новый APK/bundle не требовался: runtime source не менялся.

Rehearsal DB содержит дополнительные r04_* объекты и только выбранные владельцы:
это **не** готовый fitcoach_v3.db и его нельзя публиковать через current restore.
Runtime ExpoRestoreJobs пока принимает common3.0 snapshots, не2.0. Общая композиция
с legacy custom questionnaire revisions/answers теперь проверена в отдельном
[questionnaire-enabled staging](R04_QUESTIONNAIRE_STAGING.md):83/83 targeted.
Профильный режим выше остаётся отдельно совместимым. Остаются WorkData owner и
согласованные timestamps/provenance, все остальные домены/ID maps/полная parity,
конвертер JSON v1/v2, job checkpoint/retry/Android. R04/D03/R05 и migration/overlay/
signing/release gates OPEN. Общая цель ACTIVE, не100%.
