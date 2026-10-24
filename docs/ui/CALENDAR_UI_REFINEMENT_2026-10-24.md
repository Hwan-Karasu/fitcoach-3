# Календарь, питание и навигация — 2026-10-24

Входы: поручения владельца в чате; текущие CalendarScreen/MonthGrid/WeekPager и UI-OWN-021; Product §§13.2,13.8,13.12,13.17,49.13–22. Работы выполнены последовательно: стабильность общей панели (Z01), дневник питания (N02, зависимости N01/F06), компоновка настроек календаря (K02), оформление меню (Z01). Android/UI-приёмка остаётся открытой; production migration/signing/release gates не закрывались.

## Общая панель

Убрано увеличение flex активной кнопки 1 → 1.25: все элементы всегда занимают одинаковые доли с flexBasis 0. Меняется только подсветка/начертание. Исправление действует и для Клиенты/Календарь/Архив, и для вкладок внутри клиента. Высота, стрелки недель, подписи и настройки панели сохранены.

## Питание → Дневник

Общий `shared/ui/components/CalendarPager.tsx` использует те же native FlatList pagingEnabled/windowSize 3/initialNumToRender 1/maxToRenderPerBatch 2, что календарь записей. MonthGrid раздела записей переведён на него без изменения данных/выбора дат. Область измеряется точно, ширина страницы не округляется; внешняя смена даты плавно перематывает ленту, изменение ширины восстанавливает позицию без анимации. Промежуточные события программной прокрутки не возвращают старую страницу.

В DiaryWeekHeader убран PanResponder со скачком даты после отпускания. Недели и месяцы теперь следуют горизонтальному жесту и останавливаются на странице; неделя сохраняет выбранный день недели. Стрелки листания заменены свайпом, как в календаре записей. Есть «Сегодня» и доступные действия следующего/предыдущего месяца на заголовке для TalkBack. Месяц — шесть полных недель с соседними датами и неизменной высотой. Просмотр месяца не меняет выбранный день; выбор даты/«Сегодня» закрывает модальное окно. Fade открытия/закрытия сохранён.

Отметки еды предзагружаются для текущего и соседних периодов; вода не создаёт отметку. Закрытое окно месяца не читает БД и не держит подписку. При смене клиента старые отметки не отображаются. Репозитории еды, снимки состава, логика расчётов и дата владельца дневника не менялись. `DiaryCalendar.ts` дополнен чистыми функциями полной месячной сетки и смещений страниц; прежняя monthGrid с null сохранена для прежних потребителей.

## Настройки календаря

Активные и архивные типы занятий размещены в две равные колонки; нечётная последняя карточка сохраняет ширину колонки. Редактирование, default и архивация работают прежними командами. Выбор категорий для копирования и очистки — по три равные компактные пилюли в одном ряду без ScrollView. Политики остаются независимыми переключателями.

Убран второй заголовок вложенного CalendarNavigator. RootHeader показывает «Назад» и «Настройки календаря» в верхней строке вместе с шестерёнкой, уведомлениями и меню. Возврат адресован ключу вложенного календарного стека через POP_TO_TOP; другие вкладки не сбрасываются.

## Боковое меню

Единая тематическая подложка с округлением левого края, знак приложения, пункты с иконками на мягком акценте, округлые поверхности, компактная типографика и стандартные chevron/X. Сохранены native анимация, закрытие перед переходом, уменьшение движения и восстановление accessibility focus. Разработческие пункты и примечания убраны из меню; внутренние dev-маршруты/инструменты не удалены.

## Проверки и пределы

- TypeScript strict и lint; проверка границ модулей.
- 56 тестов календаря питания, записей еды, выбора и слотов панели: проходят. Новые случаи включают 42 последовательные даты, високосный февраль, границы месяцев/лет/DST и обратимость смещений месяца.
- 13 тестов календаря записей: проходят, включая типы занятий, копирование/очистку и сохранение настроек.
- 27 тестов оформления/навигации: проходят.
- Android JS bundle и assets: успешно (не APK).
- Не выполнены screenshot/diff и измерение FPS. На Android проверить медленный свайп/отменённый жест/быстрые свайпы, возврат «Сегодня», выбор соседнего месяца, обновление отметок после записи еды, смену клиента, TalkBack, крупный шрифт, ширину обоих календарей после изменения окна, верхнюю шапку настроек и неподвижность кнопок навигации.

Основные файлы: RootTabBar, RootTabs, RootHeader, CalendarNavigator, CalendarSettingsScreen, MonthGrid, CalendarPager, DiaryWeekHeader, DiaryCalendar, SettingsDrawerPreview и nutrition-calendar.test.ts. SQLite-схема и пользовательские факты не изменялись.

## Последующее уточнение владельца: карточки и редактор

Верхняя подсказка удалена. По новому поручению типы занятий показаны по одному на всю ширину вместо двух колонок; «Изменить» и «По умолчанию» помещаются в одной строке, архив остаётся ниже. Добавление и изменение открывают компактный SessionTypeEditor поверх текущего экрана, а не форму после списка. Категории — сетка 2×2, длительность — сегменты в один ряд, цвета — семь кружков в один ряд, списание — Switch. Кнопки сохранения/отмены закреплены внизу окна; при клавиатуре содержимое прокручивается. Ошибки сохранения показаны в редакторе, закрытие и изменение полей блокируются во время записи, историческая блокировка списания сохранена.

Дополнительно «К списку клиентов» убрана из основной панели Клиенты/Календарь/Архив: там уже есть вкладка клиентов. Настраиваемая строка остаётся только на панели карточки клиента.

Проверки этого уточнения: TypeScript, lint, 13 календарных тестов и границы модулей. Повторный просмотр обновлённого окна на устройстве не выполнен: во время проверки телефон заблокирован. Снимки до исправления использовались для оценки переполнения; экран блокировки не просматривался.

## Удаление типа занятия

В углу активных и архивных карточек добавлен крестик семантического цвета danger с доступным названием. После подтверждения удаляется неиспользованный тип, отличный от default. Проверки выполняются в одной транзакции WriterCoordinator; использованные, в том числе отменённые, записи и внешние FK (абонементы) блокируют удаление. Предлагается прежняя архивация. Используемые типы физически не удаляются согласно §13.8. Тип по умолчанию сначала нужно сменить. Подтверждение остаётся открытым и показывает ошибку при гонке/ограничении ссылки.

Начальный набор создаётся при первом появлении настроек календаря, чтобы удалённые неиспользованные стартовые типы не создавались снова на каждом boot. Схема SQLite не менялась. Список обновляется только после commit. Проверки: 16 календарных тестов, 35 учёта, 4 boot, 5 production-database, TypeScript, lint, границы модулей и Android JS bundle прошли. Новые тесты проверяют повторную инициализацию, ссылки, историю, default и оба порядка гонки записи/удаления. Реальное удаление пользовательских типов агентом не выполнялось.
Крестик и сохранённый единый ряд действий дополнительно проверены по фактическому экрану телефона в Expo. Кнопки удаления пользовательских типов не подтверждались.
# Additional owner refinements: duty colour and settings copy

- K02 follow-up, Appointment Editor (Product §§13.7 and 22.1.4): owner requested the same compact contextual menu treatment and explicitly replaced client chips with search-only dropdown results. Inputs: AppointmentEditorScreen, CalendarScreen modal, existing ChoiceSegments/SelectionChip/TextField components and participant directory port. No storage, migration or release work is involved.
- Appointment editor is a rounded centred window with keyboard avoidance. Participant section comes first so matching clients remain visible with the keyboard open. Empty search shows no client list; a nonblank search opens a bounded, scrollable list (up to eight existing matches, 176 dp viewport). Picking a client clears the query, dismisses the keyboard and leaves the selected name. The same search interaction is used for correction and guest linking.
- Date/time controls are compact, duration is one segmented row, participant mode uses equal-width chips, session types use two columns, note uses compact input. Save/cancel and applicable delete are fixed in a footer outside form scrolling. Outcome, settlement and historical-record rules are preserved.
- Validation: mobile TypeScript, targeted ESLint, 19 calendar tests and module boundaries pass. On the attached Expo phone, inspected the new-record form, typed a search, checked multiple matching rows with keyboard open, selected a client and confirmed that results/keyboard close while the name and credit context remain. Closed the unsaved form; no appointment was created. Temporary screenshots were removed.

- Latest removal correction: reproduced a failed confirmation on the attached Expo phone. Settings cross now always archives and hides the type, using the established archive command; it does not attempt physical deletion. This is the owner's requested removal with retained history. Physically deleting unused rows remains a protected repository operation but is no longer the Settings cross path. At the owner's explicit request, removed Consultation and Study through their crosses on the attached phone, confirming success notices and disappearance of both cards. No appointment/credit deletion commands were issued.
- Duty is a permanent built-in card immediately after Personal Training, with a Built-in badge; regular tap-to-book behaviour is unchanged, as clarified by the owner.
- Active type colours now resolve to distinct categorical swatches (green, blue, violet, yellow, red, grey), reserving duty's colour (orange by default). Old duty shades normalize to their canonical family. Occupied swatches are disabled, new types receive an available swatch, and saving with a duplicate is rejected. When all swatches are occupied, creation explains that a type must be archived to release a colour. Automatic legacy colours are stabilized on saving an edit to avoid shifting other types' colours.
- Validation: mobile TypeScript, targeted ESLint, 19 calendar tests and 27 theme/settings tests pass; architecture checks pass (515 source files). The root-wide TypeScript command currently fails in unrelated scripts/r04-nutrition-stage.test.ts (`DevRecipeCatalogRepository.list`); full lint previously failed on an unrelated unused Raw import. Those unrelated edits were left untouched. Phone success screenshots were inspected and removed from disk.

- Owner clarified removal semantics: remove a type from the list while preserving appointment and credit history. The cross now confirms removal; used or foreign-key-referenced types are archived by Calendar and hidden from the Settings archive through persisted appearance `hiddenSessionTypeIds`. Unused types are physically removed as before. Default-type protection remains. No appointments or credit rows are deleted, no DDL added. Settings failure uses the existing save-error toast; the archived type remains safe if persisting the hidden list fails.
- Duty card is placed immediately after Personal Training (first active type as fallback). Colour editing stays in its compact Save/Cancel dialog.
- Updated validation: TypeScript, targeted ESLint, 27 theme/settings tests and 16 calendar tests pass, including restart persistence of hidden IDs and validation of corrupt settings. No user types were removed during verification.

- Follow-up: duty now appears as a card alongside session types, with a swatch, title and Edit action. Edit opens a compact colour dialog with explicit Save/Cancel; cancelling leaves the saved colour unchanged. TypeScript and targeted ESLint pass.

- Owner request: change duty colour independently of session types. Calendar Settings now has six swatches and a theme default. Timeline duties read this presentation preference for existing and new intervals; blocked intervals retain their semantic colour. The preference uses the existing Settings appearance JSON, without DDL or interval mutations, and survives theme/accent changes and reopening the database.
- Removed Settings intro and client roster settings intro. Birthday setting chip pairs fill the available width equally.
- Inputs: existing CalendarSettingsScreen, TimelineGrid, SettingsPort appearance persistence; Product §§13.8/13.16 distinguish session types and presentation colours. Migration/release gates remain outside this UI change.
- Validation: TypeScript, 27 theme/settings tests, module boundaries and ESLint on changed files pass. Full lint is blocked by an existing unused `Raw` import in scripts/r04/LegacyNutritionProjection.ts. No phone visual verification of this addition claimed.

