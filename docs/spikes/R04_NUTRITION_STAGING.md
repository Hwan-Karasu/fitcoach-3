# R04: продукты, рецепты и исторические пищевые записи

Текущее [продолжение по недельным архивам](R04_NUTRITION_ARCHIVE_STAGING.md) вводит
private archive snapshots и Nutrition V3; production storage/backup ещё OPEN.

Первый срез ниже соответствует `800ebb1`. Продолжение по калькулятору,
Nutrition mode V2 и дополнительным проверкам находится в конце документа.

2026-10-24, база `f0a241f`. Задача R04 → R03; Product §§49.3–49.5,
49.22–49.24, 49–50, 53–56; INT-03–12. Входы: immutable snapshots клиентов,
замеров и шести legacy Nutrition stores; проверенная карта клиентов и существующая
D01 baseline питания. Предыдущие владельцы — профили/анкеты/рабочие данные,
каталог упражнений/планы/шаблоны/архивы/выполнение/замеры.

Migration/production DDL/overlay/signing/release gates остаются OPEN. Это частичный
synthetic private staging, `finalizable:false`, без подключения legacy restore
к приложению. Новых production DDL нет. Не разрешает публикацию частичного импорта.

## Подтверждённые источники

Read-only `Hwan-Karasu/fitcoach@e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [FoodProductRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/FoodProductRepository.ts)
  и [NutritionRecipeRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/NutritionRecipeRepository.ts)
  задают physical rows, режим grams/pieces, состав и сохранённые итоги рецепта.
- [nutritionEntryBuilders](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/nutritionEntryBuilders.ts)
  сохраняет productSnapshot и итоги конкретной порции. Пересборка порции сохраняет
  createdAt, отдельного времени правки записи не доказывает.
- [nutritionPortionMath](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/nutritionPortionMath.ts)
  использует основу 100 г либо 1 штуку, округляет kcal до целых, БЖУ до десятых.
  Поэтому пересчёт средствами 3.x может отличаться от фактически сохранённых итогов.
- [kbjuScreenActions, addRecipeToSlots](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/application/kbjuScreenActions.ts#L363)
  разворачивает рецепт в самостоятельные продуктовые записи. Нельзя добавлять
  поверх них ещё один факт рецепта или угадывать recipeId по сходству состава.
- [nutritionMealsParse](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/nutritionMealsParse.ts)
  явно задаёт grams при отсутствии snapshot servingMode/entry unit. Только этот
  доказанный default используется; неизвестный явный режим не переименовывается.
- [recipeBuilders](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/recipeBuilders.ts)
  и [nutritionHistoryTypes](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/nutritionHistoryTypes.ts)
  подтверждают исторические снимки ингредиентов и отдельные недельные агрегаты.
  Агрегат недели не доказывает семь дневных пищевых фактов.
- [CustomFoodScreen](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/screens/CustomFoodScreen.tsx)
  и [foodPickerCopy](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/foodPickerCopy.ts)
  не подтверждают единицы всех дополнительных нутриентов. Их нельзя автоматически
  объявлять граммами/миллиграммами.

Legacy `Number(value)||0`, ошибки JSON → пустой массив и другие нормализаторы
источника не копируются: они могли бы скрыть неизвестное значение или потерю.

## Представление в существующей D01

`LegacyNutritionSourceReader` читает полные строки/все столбцы food_products,
nutrition_recipes, nutrition_days, client_day_facts, client_kbju_state,
nutrition_archive_weeks в caller-owned source snapshot. Отсутствие таблицы — null,
отдельно от пустой таблицы. Не запускает legacy migrations и не исправляет источник.

Числа JSON извлекаются с исходным числовым token Node 24; десятые вычисляются точно.
Лишняя точность, неверные значения и неподдерживаемые формы остаются raw/review,
без округления, обрезания или подстановки нуля. Каталожные продукты сохраняют
имя/бренд/штрихкод, исходную основу и КБЖУ, массу штуки, favorite и timestamps.

Дневник использует собственный исторический productSnapshot и сохранённые итоги.
Если итоги отличаются от нового расчёта, используется штатный override с базой
исходной порции. Изменённый/удалённый продукт не подменяет snapshot. Для отсутствующего
продукта создаётся стабильная ссылка, но не вымышленная строка каталога. D01 diary
может существовать самостоятельно, без FK на справочный продукт.

Записи разных ID/клиентов не сливаются по названию, порции или КБЖУ. Повторный
physical entry ID, неизвестный клиент и разные snapshots client_day_facts в Nutrition
и Measurements откатывают всех владельцев. В source receipt сохраняются все поля.

CreatedAt записи берётся из подтверждённого timestamp; иначе это техническое время
импорта с явным provenance basis, а не угаданное время приёма пищи. UpdatedAt —
техническое время импорта с basis IMPORT_TIME; время правки дня не объявляется
временем правки каждой порции. Дата дневника берётся из исходного date_key.

Вода независима от еды; день только с водой не становится учтённым пищевым днём.
Положительные целые steps попадают в nutrition_daily_steps. Подтверждённые Да/Нет
попадают только в nutrition_daily_workout_marks, не создают Workout/Calendar/Credit.

Рецепт записывается в recipes/recipe_ingredients только если текущий каталог точно
соответствует историческим снимкам ингредиентов, сохранённым итогам и точной порции.
Сохраняются description, servings и in_cookbook; cooked_mass не придумывается.
Дубликаты ингредиентов не объединяются ради UNIQUE ограничения.

## Что остаётся неподдержанным

- Изменённая историческая версия ингредиента рецепта; старое округление, не
  представимое текущим расчётом; повтор одного продукта в рецепте. Полный источник
  сохраняется, рецепт помечается review без подмены состава/сумм или теневых клонов.
- Неизвестный фактический нутриент при известном значении в snapshot, если текущая
  модель вместо NULL пересчитала бы факт. Требуется отдельное storage решение.
- Ненулевые дополнительные нутриенты без доказанных единиц.
- Настройки калькулятора/manual targets и недельные архивы: полный raw сохраняется
  с CALCULATOR_MAPPING_REQUIRED/ARCHIVE_AGGREGATE_MAPPING_REQUIRED; это не готовая
  миграция этих владельцев. Вес/процент жира калькулятора не создаёт замеры.
- Явные нулевые steps не помещаются в нынешний CHECK >= 1: остаются review,
  а не исчезают как неизвестное значение. Вне диапазона/точности — также review.
- Неподтверждённая recipe-entry форма, повреждённый JSON и другие неизвестные
  варианты не превращаются в пустую историю. Исходные строки остаются в receipt.

Private review/provenance ещё требует production storage, включения в обычные
копии 3.x и UX. Source и target manifest SHA/parity не заменяют эту работу.

## Атомарность, повтор и доказательства

`stageClientNutrition` требует всех предыдущих владельцев, frozen Nutrition input
до их callbacks и общую транзакцию. Использует существующую baseline только в
synthetic job и private ID/receipt таблицы. Binding NUTRITION_REHEARSAL_V1 не
переоткрывает более старые jobs как новые. Все Nutrition tables, включая пока
неиспользуемые, входят в проверку схемы и target parity; неиспользуемые пусты.

Идентичность account-scoped, UUID устойчивы; коллизии с предыдущими владельцами
не скрываются как value-review. Полные source rows, representations и target IDs
в receipt; source SHA, target manifest SHA, полный набор таблиц/строк проверяется
при чтении и повторе. Нарушение source/target/provenance блокирует продолжение.

Проверено 550/550 targeted tests: R04 Plans и зависимости, measurement projection,
source-fact preflight, SQLite backup, food catalog/recipes/diary/edit/energy/stats/
calculator store. Новых тестов 16: 15 Nutrition + один cross-owner Execution.
Проверены каждое Nutrition write boundary и before-commit, полный rollback IDs/
предыдущих владельцев, чистый retry, frozen input, read-only source, byte identity,
reopen, перестановка строк/ключей и переиспользование IDs.

Нормализованные факты D01 скопированы в полную обычную 3.x DB без r04 tables,
создана .atbackup, восстановлена новая DB и прочитана обычными repositories.
Сверены все Nutrition/Measurement rows и ID. Исторические итоги не изменились после
правки каталога. Это доказывает перенос уже нормализованных фактов через обычную
копию, но не полный legacy import, private review/provenance или APK без импортера.

Root/mobile TypeScript, scoped ESLint, source baseline 73, secrets check, module
boundaries и diff check прошли. Full foundation, bundle/APK, Android/phone в этом
срезе не запускались; реальные 2.0 и пользовательские данные не затрагивались.

Следующий участок: калькулятор/цели и недельные архивы; затем остальные owners,
production representations/review storage, полная сверка и подключённое восстановление
SQLite/JSON legacy, Android и доказательство переходного/обычного релизов.

## Продолжение: профиль калькулятора (R04, база 800ebb1)

Входы/зависимости прежние: frozen client_kbju_state, карта клиентов и Nutrition
baseline после всех предыдущих владельцев. Product §§49.8–49.12, 49–50, 53–56,
INT-03–12. Все production/migration/release gates OPEN; только synthetic staging.
Реализован перенос подтверждённых параметров расчёта в nutrition_calc_profiles.
LegacyNutritionCalculator сопоставляет точные enums goal/activity/intensity и
проверенные целые workouts/duration/deficit через действующий validateCalcProfile.
Явные 0 тренировок/0 поправки сохраняются. Пустое/missing значение не становится 0;
неизвестные enums, дроби и выход за диапазон остаются raw/review. Числовые строки
с точным целым значением вроде 03.00/90,0 сохраняют значение, не округляются.

Источники read-only на том же exact ref:

- [ClientKbjuStateRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/ClientKbjuStateRepository.ts)
  хранит текущие profile_json/manual_kbju_json и время правки всей строки.
  Его fallback/default merge не переносится как доказательство сохранённых полей.
- [kbjuTypes](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/kbjuTypes.ts)
  доказывает набор полей, единицы и точные labels.
- [kbjuProfileSeed](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/kbjuProfileSeed.ts)
  и [kbjuScreenActions](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/application/kbjuScreenActions.ts#L70)
  могли подставить антропометрию из карточки. Это не отдельный замер/изменение карточки.
- [deriveKbjuMetrics](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/engine/deriveKbjuMetrics.ts)
  и [macroMath](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/engine/macroMath.ts)
  применяли manual БЖУ как входы расчёта, с округлением и заполнением отсутствующих
  макросов. Сохранённый ввод не доказывает итоговый датированный Nutrition Target.

Антропометрические поля калькулятора остаются отдельным snapshot с UNKNOWN date,
без targetMeasurementIds/перезаписи карточки. Частичное присутствие и неизвестные
поля отражены явно. Manual JSON разбирается независимо от profile JSON: повреждение
одного не уничтожает другой. Исходные строки, дроби, нули, null и неизвестные поля
сохраняются; непустой ввод требует storage решения. Не вычисляются калории из БЖУ,
не создаются версии целей/исключения или guessed effectiveFrom из updated_at/дня
импорта. Технический updated_at профиля = importTime с явным basis.

Новые representations входят в общий SHA/manifest parity. Binding
NUTRITION_REHEARSAL_V2 и projectionVersion2 отклоняют старые private jobs без
автоматической пересборки. Новых таблиц/production DDL нет; все обычные Nutrition
tables уже входят в rollback/target guards. Результат сообщает nutritionCalcProfileRows.

593/593 area+deps (предыдущий набор + Nutrition Targets/Calc), 22 Nutrition tests,
семь новых calculator tests. После расширения cross-owner fixture дополнительно
67/67 Nutrition+Execution: сбой receipt откатывает также 5 выполненных фактов,
3 компонента тренировок, вес, пищу и профиль расчёта; retry не создаёт Workout.
Все write boundaries теперь выполняются с непустыми
профилями двух клиентов, включая 0/0; полный rollback/retry проверен. Readonly/
reopen/reorder/byteidentity proof включает профили. Обычная 3.x .atbackup→restore
сверяет все строки, и обычный DevNutritionCalcRepository читает исходные параметры.
Это по-прежнему proof нормализованных фактов, не private snapshots/provenance/полного
legacy restore/APK removal. Root/mobile TypeScript, scoped ESLint, source73,
secrets и arch pass. Во время первой mobile проверки параллельно редактировался
AppointmentEditorScreen; после появления недостающих styles mobile TypeScript
перепроверен успешно. Этот чужой UI-файл не правился в данном срезе. Fullsuite/
bundle/APK/Android/phone не запускались.

Недельные архивы ещё требуют сопоставления. Проверены read-only
[NutritionHistoryRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/NutritionHistoryRepository.ts)
и [nutritionHistory](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/nutritionHistory.ts):
days_json и недельные residual aggregates различны; более поздние архивные снимки
могли перекрывать дневные поля, текущий дневник/дневные факты имели свой приоритет.
Нельзя распределять средние по семи дням, объединять физические версии по startDate
или создавать пищевые записи из summary. Следом нужны их историческое представление
и правила overlap, production review/provenance storage, остальные owners/полный
legacy restore и Android. Неподдержанные значения не считаются завершённым переносом.
