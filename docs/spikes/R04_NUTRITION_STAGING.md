# R04: продукты, рецепты и исторические пищевые записи

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
